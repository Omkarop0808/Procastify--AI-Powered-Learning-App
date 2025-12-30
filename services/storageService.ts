import { UserStats, UserPreferences, Note, Summary, QueueItem, RoutineTask, Quiz } from '../types';
import { db } from '../firebaseConfig';
import { doc, getDoc, setDoc, collection, getDocs, writeBatch, query, where } from 'firebase/firestore';


const LOCAL_KEYS = {
    USER_SESSION: 'procastify_session',
    USERS_DB: 'procastify_users_db',
    STATS: 'procastify_stats',
    NOTES: 'procastify_notes',
    SUMMARIES: 'procastify_summaries',
    QUEUE: 'procastify_queue',
    TASKS: 'procastify_tasks',
    QUIZZES: 'procastify_quizzes'
};


const getLocalDB = <T>(key: string): T[] => {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
};

const saveLocalDB = <T>(key: string, data: T[]) => {
    localStorage.setItem(key, JSON.stringify(data));
};


const getLocalUserItems = <T extends { userId: string }>(key: string, userId: string): T[] => {
    return getLocalDB<T>(key).filter(item => item.userId === userId);
};


const saveLocalUserItems = <T extends { userId: string }>(key: string, userId: string, items: T[]) => {
    const all = getLocalDB<T>(key);
    const others = all.filter(i => i.userId !== userId);
    saveLocalDB(key, [...others, ...items]);
};



let currentUserId: string | null = null;
let isGuestMode: boolean = true;

export const StorageService = {
    
    

    setSession: (user: UserPreferences) => {
        currentUserId = user.id;
        isGuestMode = user.isGuest;
        if (user.isGuest) {
            localStorage.setItem(LOCAL_KEYS.USER_SESSION, user.id);
            
            const users = JSON.parse(localStorage.getItem(LOCAL_KEYS.USERS_DB) || '{}');
            users[user.id] = user;
            localStorage.setItem(LOCAL_KEYS.USERS_DB, JSON.stringify(users));
        } else {
            localStorage.removeItem(LOCAL_KEYS.USER_SESSION); 
        }
    },

    getGuestSession: (): UserPreferences | null => {
        const sessionId = localStorage.getItem(LOCAL_KEYS.USER_SESSION);
        if (sessionId) {
            const users = JSON.parse(localStorage.getItem(LOCAL_KEYS.USERS_DB) || '{}');
            return users[sessionId] || null;
        }
        return null;
    },

    createGuestUser: (): UserPreferences => {
        const timestamp = Date.now();
        const shortId = timestamp.toString().slice(-4);
        const guestId = `guest_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
        
        return {
            id: guestId,
            isGuest: true,
            name: `Guest #${shortId}`,
            freeTimeHours: 2,
            energyPeak: 'morning',
            goal: 'Productivity',
            distractionLevel: 'medium'
        };
    },

   

    getUserProfile: async (userId: string): Promise<UserPreferences | null> => {
        
        try {
            const docRef = doc(db, 'users', userId);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                return snap.data() as UserPreferences;
            }
            return null; 
        } catch (e) {
            console.error("Error fetching profile", e);
            return null;
        }
    },

    saveUserProfile: async (user: UserPreferences) => {
        if (user.isGuest) {
            const users = JSON.parse(localStorage.getItem(LOCAL_KEYS.USERS_DB) || '{}');
            users[user.id] = user;
            localStorage.setItem(LOCAL_KEYS.USERS_DB, JSON.stringify(users));
        } else {
            await setDoc(doc(db, 'users', user.id), user);
        }
    },

    

    getStats: async (): Promise<UserStats> => {
        if (!currentUserId) return createEmptyStats('unknown');

        if (isGuestMode) {
            const all = getLocalDB<UserStats>(LOCAL_KEYS.STATS);
            let stats = all.find(s => s.userId === currentUserId);
            if (!stats) {
                stats = createEmptyStats(currentUserId);
                all.push(stats);
                saveLocalDB(LOCAL_KEYS.STATS, all);
            }
            return stats;
        } else {
            
            const docRef = doc(db, 'users', currentUserId, 'data', 'stats');
            const snap = await getDoc(docRef);
            if (snap.exists()) return snap.data() as UserStats;
            
            
            const newStats = createEmptyStats(currentUserId);
            await setDoc(docRef, newStats);
            return newStats;
        }
    },

    updateStats: async (updater: (prev: UserStats) => UserStats) => {
        if (!currentUserId) return;
        
        const current = await StorageService.getStats();
        const updated = updater(current);

        if (isGuestMode) {
            const all = getLocalDB<UserStats>(LOCAL_KEYS.STATS);
            const idx = all.findIndex(s => s.userId === currentUserId);
            if (idx >= 0) all[idx] = updated;
            else all.push(updated);
            saveLocalDB(LOCAL_KEYS.STATS, all);
        } else {
            await setDoc(doc(db, 'users', currentUserId, 'data', 'stats'), updated);
        }
        return updated;
    },

    checkLoginStreak: async () => {
        if (!currentUserId) return;
        const stats = await StorageService.getStats();
        const lastDate = new Date(stats.lastLoginDate).toDateString();
        const today = new Date().toDateString();

        if (lastDate !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            let newStreak = stats.loginStreak;
            if (lastDate === yesterday.toDateString()) newStreak += 1;
            else newStreak = 1;

            await StorageService.updateStats(s => ({
                ...s,
                loginStreak: newStreak,
                lastLoginDate: new Date().toISOString()
            }));
        }
    },

    logStudyTime: async (minutes: number) => {
        if (!currentUserId) return;
        const todayKey = new Date().toISOString().split('T')[0];
        await StorageService.updateStats(s => {
            const currentDaily = s.dailyActivity[todayKey] || 0;
            return {
                ...s,
                totalTimeStudiedMinutes: s.totalTimeStudiedMinutes + minutes,
                dailyActivity: { ...s.dailyActivity, [todayKey]: currentDaily + minutes }
            };
        });
    },

    

    migrateData: async (guestId: string, authId: string) => {
        
        const notes = getLocalUserItems<Note>(LOCAL_KEYS.NOTES, guestId);
        const summaries = getLocalUserItems<Summary>(LOCAL_KEYS.SUMMARIES, guestId);
        const queue = getLocalUserItems<QueueItem>(LOCAL_KEYS.QUEUE, guestId);
        const tasks = getLocalUserItems<RoutineTask>(LOCAL_KEYS.TASKS, guestId);
        const allStats = getLocalDB<UserStats>(LOCAL_KEYS.STATS);
        const guestStats = allStats.find(s => s.userId === guestId);

        
        const batch = writeBatch(db);
        
        
        notes.forEach(item => {
            const ref = doc(db, 'users', authId, 'notes', item.id);
            batch.set(ref, { ...item, userId: authId });
        });
        
        
        summaries.forEach(item => {
            const ref = doc(db, 'users', authId, 'summaries', item.id);
            batch.set(ref, { ...item, userId: authId });
        });

       
        queue.forEach(item => {
             const ref = doc(db, 'users', authId, 'queue', item.id);
             batch.set(ref, { ...item, userId: authId });
        });

        
        tasks.forEach(item => {
             const ref = doc(db, 'users', authId, 'tasks', item.id);
             batch.set(ref, { ...item, userId: authId });
        });

        
        const quizzes = getLocalUserItems<Quiz>(LOCAL_KEYS.QUIZZES, guestId);
        quizzes.forEach(item => {
             const ref = doc(db, 'users', authId, 'quizzes', item.id);
             batch.set(ref, { ...item, userId: authId });
        });

        
        if (guestStats) {
             const statsRef = doc(db, 'users', authId, 'data', 'stats');
             // We just overwrite or set for simplicity, real app might merge
             batch.set(statsRef, { ...guestStats, userId: authId, id: `stats_${authId}` });
        }

        await batch.commit();
    },

    
    
    getNotes: async (): Promise<Note[]> => {
        return StorageService.loadCollection<Note>('notes');
    },

    saveNotes: async (notes: Note[]) => {
        if (!currentUserId) return;
        if (isGuestMode) {
            saveLocalUserItems(LOCAL_KEYS.NOTES, currentUserId, notes);
        } else {
            const batch = writeBatch(db);
            notes.forEach(note => {
                const ref = doc(db, 'users', currentUserId, 'notes', note.id);
                batch.set(ref, note);
            });
            await batch.commit();
        }
    },

    

    getSummaries: async (): Promise<Summary[]> => {
        return StorageService.loadCollection<Summary>('summaries');
    },

    saveSummaries: async (summaries: Summary[]) => {
        if (!currentUserId) return;
        if (isGuestMode) {
            saveLocalUserItems(LOCAL_KEYS.SUMMARIES, currentUserId, summaries);
        } else {
            const batch = writeBatch(db);
            summaries.forEach(summary => {
                const ref = doc(db, 'users', currentUserId, 'summaries', summary.id);
                batch.set(ref, summary);
            });
            await batch.commit();
        }
    },

    

    getQueue: async (): Promise<QueueItem[]> => {
        return StorageService.loadCollection<QueueItem>('queue');
    },

    saveQueue: async (queue: QueueItem[]) => {
        if (!currentUserId) return;
        if (isGuestMode) {
            saveLocalUserItems(LOCAL_KEYS.QUEUE, currentUserId, queue);
        } else {
            const batch = writeBatch(db);
            queue.forEach(item => {
                const ref = doc(db, 'users', currentUserId, 'queue', item.id);
                batch.set(ref, item);
            });
            await batch.commit();
        }
    },

    

    getTasks: async (): Promise<RoutineTask[]> => {
        return StorageService.loadCollection<RoutineTask>('tasks');
    },

    saveTasks: async (tasks: RoutineTask[]) => {
        if (!currentUserId) return;
        if (isGuestMode) {
            saveLocalUserItems(LOCAL_KEYS.TASKS, currentUserId, tasks);
        } else {
            const batch = writeBatch(db);
            tasks.forEach(task => {
                const ref = doc(db, 'users', currentUserId, 'tasks', task.id);
                batch.set(ref, task);
            });
            await batch.commit();
        }
    },

    

    getQuizzes: async (): Promise<Quiz[]> => {
        return StorageService.loadCollection<Quiz>('quizzes');
    },

    saveQuiz: async (quiz: Quiz) => {
        if (!currentUserId) return;
        if (isGuestMode) {
            const quizzes = getLocalUserItems<Quiz>(LOCAL_KEYS.QUIZZES, currentUserId);
            const existingIndex = quizzes.findIndex(q => q.id === quiz.id);
            if (existingIndex >= 0) {
                quizzes[existingIndex] = quiz;
            } else {
                quizzes.push(quiz);
            }
            saveLocalUserItems(LOCAL_KEYS.QUIZZES, currentUserId, quizzes);
        } else {
            const ref = doc(db, 'users', currentUserId, 'quizzes', quiz.id);
            await setDoc(ref, quiz);
        }
    },

   

    
    loadCollection: async <T extends { userId: string }>(collectionName: string): Promise<T[]> => {
        if (!currentUserId) return [];
        if (isGuestMode) {
            
            const map: Record<string, string> = {
                'notes': LOCAL_KEYS.NOTES,
                'summaries': LOCAL_KEYS.SUMMARIES,
                'queue': LOCAL_KEYS.QUEUE,
                'tasks': LOCAL_KEYS.TASKS,
                'quizzes': LOCAL_KEYS.QUIZZES
            };
            const key = map[collectionName];
            if (!key) return [];
            return getLocalUserItems<T>(key, currentUserId);
        } else {
            const colRef = collection(db, 'users', currentUserId, collectionName);
            const snap = await getDocs(colRef);
            return snap.docs.map(d => d.data() as T);
        }
    }
};



const createEmptyStats = (userId: string): UserStats => ({
    id: `stats_${userId}`,
    userId,
    totalTimeStudiedMinutes: 0,
    notesCreated: 0,
    quizzesTaken: 0,
    loginStreak: 0,
    lastLoginDate: new Date().toISOString(),
    dailyActivity: {},
    highScore: 0
});



export const saveQuiz = async (quiz: Quiz) => {
    return StorageService.saveQuiz(quiz);
};

export const getQuizzes = async (userId: string): Promise<Quiz[]> => {
    return StorageService.getQuizzes();
};
