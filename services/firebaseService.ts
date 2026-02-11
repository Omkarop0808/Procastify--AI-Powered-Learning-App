import { db } from "../firebaseConfig";
import {
  doc,
  deleteDoc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  writeBatch,
  serverTimestamp,
  query,
  where,
  orderBy,
  Firestore,
} from "firebase/firestore";
import { Note, Folder, Classroom, Invitation, Announcement, ClassroomResource } from "../types";

export const FirebaseService = {
  // --- Notes ---
  saveNote: async (userId: string, note: Note) => {
    const ref = doc(db, "notes", note.id);

    // Ensure strictly managed fields
    const payload = {
      ...note,
      ownerId: userId,
      updatedAt: serverTimestamp(),
      // Ensure these defaults if missing
      isPublic: note.isPublic || false,
      publishedAt: note.isPublic ? note.publishedAt || serverTimestamp() : null,
      document: note.document || { blocks: [] },
      canvas: note.canvas || { elements: [], strokes: [] },
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

    await setDoc(ref, sanitizedPayload, { merge: true });
  },

  deleteNote: async (userId: string, noteId: string) => {
    const ref = doc(db, "notes", noteId);
    await deleteDoc(ref);
  },

  saveNotesBatch: async (userId: string, notes: Note[]) => {
    const batch = writeBatch(db);
    notes.forEach((note) => {
      const ref = doc(db, "notes", note.id);
      const payload = {
        ...note,
        ownerId: userId,
        updatedAt: serverTimestamp(),
        isPublic: note.isPublic || false,
      };
      // Sanitize batch payload as well
      batch.set(ref, sanitizePayload(payload), { merge: true });
    });
    await batch.commit();
  },

  // --- Public Store ---
  publishNote: async (userId: string, note: Note) => {
    // Single source of truth update
    const ref = doc(db, "notes", note.id);
    await setDoc(
      ref,
      {
        isPublic: true,
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  },

  unpublishNote: async (userId: string, noteId: string) => {
    const ref = doc(db, "notes", noteId);
    await setDoc(
      ref,
      {
        isPublic: false,
        publishedAt: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  },

  getPublicNotes: async (): Promise<Note[]> => {
    try {
      const q = query(
        collection(db, "notes"),
        where("isPublic", "==", true),
        orderBy("publishedAt", "desc"),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        // Normalize timestamps
        return mapFirestoreDataToNote(data);
      });
    } catch (e) {
      console.error("Error fetching public notes:", e);
      return [];
    }
  },

  // --- Folders ---
  saveFolder: async (userId: string, folder: Folder) => {
    const ref = doc(db, "folders", folder.id);
    const payload = {
      ...folder,
      userId,
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, sanitizePayload(payload), { merge: true });
  },

  getFolders: async (userId: string): Promise<Folder[]> => {
    try {
      const q = query(
        collection(db, "folders"),
        where("userId", "==", userId),
        orderBy("createdAt", "desc"),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          createdAt: data.createdAt?.toMillis
            ? data.createdAt.toMillis()
            : data.createdAt,
          updatedAt: data.updatedAt?.toMillis
            ? data.updatedAt.toMillis()
            : data.updatedAt,
        } as Folder;
      });
    } catch (e) {
      console.error("Error fetching folders:", e);
      return [];
    }
  },

  deleteFolder: async (userId: string, folderId: string) => {
    const ref = doc(db, "folders", folderId);
    await deleteDoc(ref);
  },

  saveFoldersBatch: async (userId: string, folders: Folder[]) => {
    const batch = writeBatch(db);
    folders.forEach((folder) => {
      const ref = doc(db, "folders", folder.id);
      const payload = {
        ...folder,
        userId,
        updatedAt: serverTimestamp(),
      };
      batch.set(ref, sanitizePayload(payload), { merge: true });
    });
    await batch.commit();
  },

  // --- Generic document operations ---
  deleteDocument: async (docRef: any) => {
    await deleteDoc(docRef);
  },

  // --- Stats (Unchanged logic, kept for interface consistency) ---
  saveDailyActivity: async (
    userId: string,
    dateKey: string,
    minutes: number,
  ) => {},

  // --- Classrooms ---
  saveClassroom: async (classroom: Classroom) => {
    const ref = doc(db, "classrooms", classroom.id);
    const payload = {
      ...classroom,
      createdAt: classroom.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, sanitizePayload(payload), { merge: true });
  },

  getClassroomsByTeacher: async (teacherId: string): Promise<Classroom[]> => {
    try {
      const q = query(
        collection(db, "classrooms"),
        where("teacherId", "==", teacherId),
        orderBy("updatedAt", "desc"),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          createdAt: data.createdAt?.toMillis
            ? data.createdAt.toMillis()
            : data.createdAt,
          updatedAt: data.updatedAt?.toMillis
            ? data.updatedAt.toMillis()
            : data.updatedAt,
        } as Classroom;
      });
    } catch (e) {
      console.error("Error fetching classrooms:", e);
      return [];
    }
  },

  getClassroomsByStudent: async (studentId: string): Promise<Classroom[]> => {
    try {
      const q = query(
        collection(db, "classrooms"),
        where("studentIds", "array-contains", studentId),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          createdAt: data.createdAt?.toMillis
            ? data.createdAt.toMillis()
            : data.createdAt,
          updatedAt: data.updatedAt?.toMillis
            ? data.updatedAt.toMillis()
            : data.updatedAt,
        } as Classroom;
      });
    } catch (e) {
      console.error("Error fetching student classrooms:", e);
      return [];
    }
  },

  deleteClassroom: async (classroomId: string) => {
    const ref = doc(db, "classrooms", classroomId);
    
    // Delete announcements subcollection
    const announcementsRef = collection(db, "classrooms", classroomId, "announcements");
    const announcementsSnap = await getDocs(announcementsRef);
    const batch = writeBatch(db);
    announcementsSnap.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    
    // Delete resources subcollection
    const resourcesRef = collection(db, "classrooms", classroomId, "resources");
    const resourcesSnap = await getDocs(resourcesRef);
    resourcesSnap.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    
    // Delete classroom document
    await deleteDoc(ref);
  },

  // --- Invitations ---
  saveInvitation: async (invitation: Invitation) => {
    const ref = doc(db, "invitations", invitation.id);
    await setDoc(ref, sanitizePayload(invitation));
  },

  getInvitationsByEmail: async (email: string, status?: string): Promise<Invitation[]> => {
    try {
      let q;
      if (status) {
        q = query(
          collection(db, "invitations"),
          where("studentEmail", "==", email),
          where("status", "==", status),
        );
      } else {
        q = query(
          collection(db, "invitations"),
          where("studentEmail", "==", email),
        );
      }
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          createdAt: data.createdAt?.toMillis
            ? data.createdAt.toMillis()
            : data.createdAt,
          respondedAt: data.respondedAt?.toMillis
            ? data.respondedAt.toMillis()
            : data.respondedAt,
        } as Invitation;
      });
    } catch (e) {
      console.error("Error fetching invitations:", e);
      return [];
    }
  },

  getInvitationsByClassroom: async (classroomId: string): Promise<Invitation[]> => {
    try {
      const q = query(
        collection(db, "invitations"),
        where("classroomId", "==", classroomId),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          createdAt: data.createdAt?.toMillis
            ? data.createdAt.toMillis()
            : data.createdAt,
          respondedAt: data.respondedAt?.toMillis
            ? data.respondedAt.toMillis()
            : data.respondedAt,
        } as Invitation;
      });
    } catch (e) {
      console.error("Error fetching classroom invitations:", e);
      return [];
    }
  },

  updateInvitation: async (invitationId: string, updates: Partial<Invitation>) => {
    const ref = doc(db, "invitations", invitationId);
    await setDoc(ref, sanitizePayload(updates), { merge: true });
  },

  // --- Announcements ---
  saveAnnouncement: async (classroomId: string, announcement: Announcement) => {
    const ref = doc(db, "classrooms", classroomId, "announcements", announcement.id);
    const payload = {
      ...announcement,
      createdAt: announcement.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, sanitizePayload(payload), { merge: true });
  },

  getAnnouncements: async (classroomId: string): Promise<Announcement[]> => {
    try {
      const q = query(
        collection(db, "classrooms", classroomId, "announcements"),
        orderBy("createdAt", "desc"),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          createdAt: data.createdAt?.toMillis
            ? data.createdAt.toMillis()
            : data.createdAt,
          updatedAt: data.updatedAt?.toMillis
            ? data.updatedAt.toMillis()
            : data.updatedAt,
        } as Announcement;
      });
    } catch (e) {
      console.error("Error fetching announcements:", e);
      return [];
    }
  },

  deleteAnnouncement: async (classroomId: string, announcementId: string) => {
    const ref = doc(db, "classrooms", classroomId, "announcements", announcementId);
    await deleteDoc(ref);
  },

  // --- Resources ---
  shareResource: async (classroomId: string, resource: ClassroomResource) => {
    const ref = doc(db, "classrooms", classroomId, "resources", resource.id);
    await setDoc(ref, sanitizePayload(resource));
  },

  getResources: async (classroomId: string): Promise<ClassroomResource[]> => {
    try {
      const resourcesRef = collection(db, "classrooms", classroomId, "resources");
      const snap = await getDocs(resourcesRef);
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          sharedAt: data.sharedAt?.toMillis
            ? data.sharedAt.toMillis()
            : data.sharedAt,
        } as ClassroomResource;
      });
    } catch (e) {
      console.error("Error fetching resources:", e);
      return [];
    }
  },

  unshareResource: async (classroomId: string, resourceId: string) => {
    const ref = doc(db, "classrooms", classroomId, "resources", resourceId);
    await deleteDoc(ref);
  },
};

// Helper to handle Firestore timestamps vs Date/Numbers
const createTimestampFromDate = (dateVal: any) => {
  // If it's already a firestore timestamp-like (not a real one here without importing Timestamp class),
  // best effort or just pass through for serverTimestamp if strictly new.
  // If it's number (Date.now()), return it date object for Firestore?
  // Firestore setDoc accepts Date objects.
  if (typeof dateVal === "number") return new Date(dateVal);
  if (dateVal instanceof Date) return dateVal;
  return serverTimestamp();
};

const mapFirestoreDataToNote = (data: any): Note => {
  return {
    ...data,
    createdAt: data.createdAt?.toMillis
      ? data.createdAt.toMillis()
      : data.createdAt,
    updatedAt: data.updatedAt?.toMillis
      ? data.updatedAt.toMillis()
      : data.updatedAt,
    publishedAt: data.publishedAt?.toMillis
      ? data.publishedAt.toMillis()
      : data.publishedAt,
  } as Note;
};

// Recursively remove undefined values from an object/array
const sanitizePayload = (obj: any): any => {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    return obj.map((v) => sanitizePayload(v)).filter((v) => v !== undefined);
  }
  if (typeof obj === "object") {
    const newObj: any = {};
    Object.keys(obj).forEach((key) => {
      const val = sanitizePayload(obj[key]);
      if (val !== undefined) {
        newObj[key] = val;
      }
    });
    return newObj;
  }
  return obj;
};
