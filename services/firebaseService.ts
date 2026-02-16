import { db } from '../firebaseConfig';
import { doc, deleteDoc, setDoc, getDoc, collection, getDocs, writeBatch, serverTimestamp, query, where, orderBy, Firestore } from 'firebase/firestore';
import { Note } from '../types';
import { apiRateLimiter } from './rateLimiter';
import { sanitizeContent } from './validation';
import logger from './securityLogger';

export const FirebaseService = {
    // --- Notes ---
    saveNote: async (userId: string, note: Note) => {
        // Rate Limiting
        if (apiRateLimiter.isLimited(userId)) {
            logger.logRateLimitViolation(userId, 'saveNote');
            throw new Error('Rate limit exceeded. Please try again later.');
        }

        const ref = doc(db, 'notes', note.id);

        // Ensure strictly managed fields
        const payload = {
            ...note,
            ownerId: userId,
            updatedAt: serverTimestamp(),
            // Ensure these defaults if missing
            isPublic: note.isPublic || false,
            publishedAt: note.isPublic ? (note.publishedAt || serverTimestamp()) : null,
            document: note.document || { blocks: [] },
            canvas: note.canvas || { elements: [], strokes: [] }
        };

        // If it's a new note (basic check), add createdAt. 
        // Ideally we pass this in, but 'merge: true' with setDoc handles it well if we don't overwrite.
        // But to be safe for existing notes being saved:
        if (!note.createdAt) {
            // We can't easily know if it exists without reading, but 'merge' is safe.
            // We simply won't set createdAt here if it's missing in the object, assume it allows serverTimestamp if new?
            // Better: App creates `createdAt` in local state for new notes.
        }

        // Sanitize payload to remove undefined values which Firestore rejects
        const sanitizedPayload = sanitizePayload(payload);

        // Additional Content Sanitization (XSS Prevention) for text fields
        if (sanitizedPayload.title) {
            sanitizedPayload.title = sanitizeContent(sanitizedPayload.title, 200);
        }

        await setDoc(ref, sanitizedPayload, { merge: true });
    },

    deleteNote: async (userId: string, noteId: string) => {
        const ref = doc(db, 'notes', noteId);
        await deleteDoc(ref);
    },

    saveNotesBatch: async (userId: string, notes: Note[]) => {
        // Rate Limiting for Batch
        if (apiRateLimiter.isLimited(userId)) {
            logger.logRateLimitViolation(userId, 'saveNotesBatch');
            throw new Error('Rate limit exceeded. Please try again later.');
        }

        const batch = writeBatch(db);
        notes.forEach(note => {
            const ref = doc(db, 'notes', note.id);
            const payload = {
                ...note,
                ownerId: userId,
                updatedAt: serverTimestamp(),
                isPublic: note.isPublic || false
            };
            // Sanitize batch payload as well
            batch.set(ref, sanitizePayload(payload), { merge: true });
        });
        await batch.commit();
    },

    // --- Public Store ---
    publishNote: async (userId: string, note: Note) => {
        if (apiRateLimiter.isLimited(userId)) {
            throw new Error('Rate limit exceeded.');
        }
        // Single source of truth update
        const ref = doc(db, 'notes', note.id);
        await setDoc(ref, {
            isPublic: true,
            publishedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, { merge: true });
    },

    unpublishNote: async (userId: string, noteId: string) => {
        const ref = doc(db, 'notes', noteId);
        await setDoc(ref, {
            isPublic: false,
            publishedAt: null,
            updatedAt: serverTimestamp()
        }, { merge: true });
    },

    getPublicNotes: async (): Promise<Note[]> => {
        try {
            const q = query(
                collection(db, 'notes'),
                where('isPublic', '==', true),
                orderBy('publishedAt', 'desc')
            );
            const snap = await getDocs(q);
            return snap.docs.map(d => {
                const data = d.data();
                // Normalize timestamps
                return mapFirestoreDataToNote(data);
            });
        } catch (e) {
            console.error("Error fetching public notes:", e);
            return [];
        }
    },

    // --- Generic document operations ---
    deleteDocument: async (docRef: any) => {
        await deleteDoc(docRef);
    },

    // --- Stats (Unchanged logic, kept for interface consistency) ---
    saveDailyActivity: async (userId: string, dateKey: string, minutes: number) => { }
};

// Helper to handle Firestore timestamps vs Date/Numbers
const createTimestampFromDate = (dateVal: any) => {
    // If it's already a firestore timestamp-like (not a real one here without importing Timestamp class),
    // best effort or just pass through for serverTimestamp if strictly new. 
    // If it's number (Date.now()), return it date object for Firestore? 
    // Firestore setDoc accepts Date objects.
    if (typeof dateVal === 'number') return new Date(dateVal);
    if (dateVal instanceof Date) return dateVal;
    return serverTimestamp();
};

const mapFirestoreDataToNote = (data: any): Note => {
    return {
        ...data,
        createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt,
        updatedAt: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : data.updatedAt,
        publishedAt: data.publishedAt?.toMillis ? data.publishedAt.toMillis() : data.publishedAt
    } as Note;
};

// Recursively remove undefined values from an object/array
const sanitizePayload = (obj: any): any => {
    if (obj === null || obj === undefined) return null;
    if (Array.isArray(obj)) {
        return obj.map(v => sanitizePayload(v)).filter(v => v !== undefined);
    }
    if (typeof obj === 'object') {
        const newObj: any = {};
        Object.keys(obj).forEach(key => {
            const val = sanitizePayload(obj[key]);
            if (val !== undefined) {
                newObj[key] = val;
            }
        });
        return newObj;
    }
    return obj;
};
