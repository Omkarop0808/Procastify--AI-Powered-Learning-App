import React, { useState, useEffect } from 'react';
import { ViewState, UserPreferences, Summary, Note, RoutineTask, UserStats, Flashcard, NoteElement } from './types';
import { StorageService } from './services/storageService';
import { auth } from './firebaseConfig';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import Sidebar from './components/Sidebar';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Summarizer from './pages/Summarizer';
import Notes from './pages/Notes';
import Routine from './pages/Routine';
import Focus from './pages/Focus';
import QuizPage from './pages/Quiz';
import NoteFeed from './pages/NoteFeed';
import NotesStore from './pages/NotesStore';
import { AlertCircle, LogIn, X, Loader2 } from 'lucide-react';

const App: React.FC = () => {
    const [view, setView] = useState<ViewState>('landing');
    const [user, setUser] = useState<UserPreferences | null>(null);
    const [loadingAuth, setLoadingAuth] = useState(true);
    const [summaries, setSummaries] = useState<Summary[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [stats, setStats] = useState<UserStats | null>(null);
    const [focusTask, setFocusTask] = useState<RoutineTask | undefined>(undefined);
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [isSignUp, setIsSignUp] = useState(false);
    const [emailInput, setEmailInput] = useState('');
    const [passwordInput, setPasswordInput] = useState('');
    const [authError, setAuthError] = useState('');

    const deriveName = (email?: string | null) => {
        if (!email) return 'User';
        return email.split('@')[0];
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {

                let profile = await StorageService.getUserProfile(firebaseUser.uid);

                if (!profile) {

                    profile = {
                        id: firebaseUser.uid,
                        isGuest: false,
                        name: deriveName(firebaseUser.email),
                        freeTimeHours: 2,
                        energyPeak: 'morning',
                        goal: 'Productivity',
                        distractionLevel: 'medium'
                    };
                    await StorageService.saveUserProfile(profile);
                }

                StorageService.setSession(profile);
                setUser(profile);
                loadUserData();
                setView('dashboard');
            } else {

                const guestUser = StorageService.getGuestSession();
                if (guestUser) {
                    StorageService.setSession(guestUser);
                    setUser(guestUser);
                    loadUserData();
                    setView('dashboard');
                } else {
                    setUser(null);
                    setView('landing');
                }
            }
            setLoadingAuth(false);
        });

        return () => unsubscribe();
    }, []);

    const loadUserData = async () => {
        try {
            await StorageService.checkLoginStreak();
            // Zero Migration: Removed migration check
            const n = await StorageService.getNotes();
            const s = await StorageService.getSummaries();
            const st = await StorageService.getStats();
            setNotes(n);
            setSummaries(s);
            setStats(st);
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    };



    const handleGuestAccess = () => {

        const guestUser = StorageService.createGuestUser();
        StorageService.saveUserProfile(guestUser);
        StorageService.setSession(guestUser);
        setUser(guestUser);
        loadUserData();
        setView('dashboard');
    };

    const handleAuthSubmit = async () => {
        if (!emailInput || !passwordInput) return;
        setAuthError('');
        try {
            if (isSignUp) {
                await createUserWithEmailAndPassword(auth, emailInput, passwordInput);
            } else {
                await signInWithEmailAndPassword(auth, emailInput, passwordInput);
            }
            setShowLoginModal(false);
            setEmailInput('');
            setPasswordInput('');
        } catch (e: any) {
            console.error(e);
            setAuthError(e.message || 'Authentication failed');
        }
    };

    const handleLogout = async () => {
        if (user?.isGuest) {
            localStorage.removeItem('procastify_session');
            setUser(null);
            setView('landing');
        } else {
            await signOut(auth);

        }
    };



    const handleStartFocus = (task?: RoutineTask) => {
        setFocusTask(task);
        setView('focus');
    };

    const handleFocusExit = (minutesSpent: number) => {
        if (minutesSpent > 0) {
            StorageService.logStudyTime(minutesSpent);
            StorageService.getStats().then(setStats);
        }
        setView('routine');
    };

    const handleAddToNote = async (noteId: string | null, summary: Summary, flashcards: Flashcard[]) => {
        if (!user) return;

        const timestamp = Date.now();
        const STICKY_COLORS = ['#fef3c7', '#dbeafe', '#dcfce7', '#f3e8ff'];

        // Convert summary text to Tiptap JSON format
        const summaryDocument = {
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 1 },
                    content: [{ type: 'text', text: `Summary: ${new Date().toLocaleDateString()}` }]
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: summary.summaryText }]
                }
            ]
        };

        const flashcardElements: NoteElement[] = flashcards.map((fc, i) => ({
            id: `${timestamp}-fc-${i}`,
            type: 'sticky',
            x: 600 + (i % 2) * 260, // Shift flashcards to right
            y: 50 + Math.floor(i / 2) * 260,
            width: 240,
            height: 240,
            content: `${fc.front}\n\n---\n${fc.back}`,
            zIndex: 10 + i,
            color: STICKY_COLORS[i % STICKY_COLORS.length]
        }));

        // Add Main Summary Text to Canvas
        const summaryElement: NoteElement = {
            id: `${timestamp}-summary`,
            type: 'text',
            x: 50,
            y: 50,
            width: 500,
            height: 600, // Approximate
            content: `**Summary**\n\n${summary.summaryText}`,
            zIndex: 5,
            fontSize: 'medium'
        };

        const initialCanvasElements = [summaryElement, ...flashcardElements];

        let updatedNotes = [...notes];
        let noteWasCreated = false;
        let noteToSave: Note | null = null;

        if (noteId === null) {
            const newNote: Note = {
                id: timestamp.toString(),
                userId: user.id,
                title: `Summary: ${new Date().toLocaleDateString()}`,
                document: { blocks: summaryDocument.content }, // Init document section
                canvas: { elements: initialCanvasElements }, // Init canvas section
                elements: initialCanvasElements, // Backward compatibility
                tags: [],
                folder: 'Summaries',
                lastModified: timestamp
            };
            updatedNotes = [newNote, ...updatedNotes];
            noteToSave = newNote;
            noteWasCreated = true;
        } else {
            updatedNotes = updatedNotes.map(n => {
                if (n.id === noteId) {
                    // Append to document if exists, or create
                    const existingBlocks = n.document?.blocks || [];
                    // Add a separator
                    const newBlocks = [
                        ...existingBlocks,
                        { type: 'horizontalRule' },
                        ...summaryDocument.content
                    ];

                    // Add flashcards to canvas
                    // Add flashcards to canvas (and summary text)
                    const maxY = (n.canvas?.elements || n.elements).reduce((max, el) => Math.max(max, el.y + el.height), 0);
                    const offsetY = maxY > 0 ? maxY + 100 : 50;

                    const newSummaryEl = { ...summaryElement, y: offsetY, id: `${timestamp}-summary-append` };

                    const newCanvasElements = flashcardElements.map((el, i) => ({
                        ...el,
                        zIndex: (n.canvas?.elements || n.elements).length + 10 + i,
                        y: el.y + offsetY - 50 // Reset y relative to offset, adjust logic if needed. 
                        // Actually flashcards were absolute y=50... need to shift them down by offsetY
                    })).map(el => ({ ...el, y: el.y + offsetY - 50 }));
                    // Wait, original flashcards y starts at 50. So offsetY + (el.y - 50) is better.
                    // Correct layout: Summary at left, Flashcards at right.

                    // Let's simplfy: Just append them all relative to offsetY
                    const shiftedSummary = { ...summaryElement, y: offsetY, id: `${timestamp}-sum-${Date.now()}` };
                    const shiftedCards = flashcardElements.map(el => ({
                        ...el,
                        y: el.y + offsetY - 50, // Shift down
                        id: `${timestamp}-fc-${el.id}` // ensure unique
                    }));

                    const allNewElements = [shiftedSummary, ...shiftedCards];

                    const updated = {
                        ...n,
                        document: { blocks: newBlocks },
                        canvas: { elements: [...(n.canvas?.elements || []), ...allNewElements] },
                        elements: [...n.elements, ...allNewElements], // Backward compatibility
                        lastModified: timestamp
                    };
                    noteToSave = updated;
                    return updated;
                }
                return n;
            });
        }

        setNotes(updatedNotes);
        if (noteToSave) {
            await StorageService.saveNote(noteToSave);
        }

        if (noteWasCreated) {
            await StorageService.updateStats(s => ({
                ...s,
                notesCreated: (s.notesCreated || 0) + 1
            }));
        }

        const updatedStats = await StorageService.getStats();
        setStats(updatedStats);
    };


    if (loadingAuth) {
        return <div className="min-h-screen bg-[#1e1f22] flex items-center justify-center text-white"><Loader2 className="animate-spin mr-2" /> Loading Procastify...</div>;
    }

    if (!user || view === 'landing') {
        return (
            <>
                <Landing onLogin={() => setShowLoginModal(true)} onGuestAccess={handleGuestAccess} />

                {/* Login Modal */}
                {showLoginModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                        <div className="bg-[#1e1f22] p-8 rounded-2xl w-full max-w-md border border-white/10 shadow-2xl animate-in zoom-in-95">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-2xl font-bold text-white">{isSignUp ? 'Create Account' : 'Welcome Back'}</h2>
                                <button onClick={() => setShowLoginModal(false)} className="text-gray-400 hover:text-white"><X /></button>
                            </div>

                            {authError && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{authError}</div>}

                            <input
                                type="email"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#5865F2] mb-4"
                                placeholder="Email"
                                value={emailInput}
                                onChange={(e) => setEmailInput(e.target.value)}
                            />
                            <input
                                type="password"
                                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#5865F2] mb-6"
                                placeholder="Password"
                                value={passwordInput}
                                onChange={(e) => setPasswordInput(e.target.value)}
                            />

                            <button
                                onClick={handleAuthSubmit}
                                disabled={!emailInput || !passwordInput}
                                className="w-full bg-[#5865F2] hover:bg-[#4752c4] text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50 mb-4"
                            >
                                {isSignUp ? 'Sign Up' : 'Sign In'}
                            </button>

                            <p className="text-center text-sm text-gray-400">
                                {isSignUp ? "Already have an account?" : "Don't have an account?"}
                                <button onClick={() => setIsSignUp(!isSignUp)} className="ml-2 text-[#5865F2] hover:underline font-bold">
                                    {isSignUp ? 'Sign In' : 'Sign Up'}
                                </button>
                            </p>
                        </div>
                    </div>
                )}
            </>
        );
    }


    if (view === 'focus') return <Focus initialTask={focusTask} onExit={handleFocusExit} />;


    return (
        <div className="flex min-h-screen bg-[#1e1f22]">
            <Sidebar currentView={view} onNavigate={setView} onLogout={handleLogout} />
            <main className="flex-1 ml-64 overflow-y-auto max-h-screen relative">
                {/* User Context Bar (Small) */}
                {user.isGuest && (
                    <div className="bg-indigo-900/30 border-b border-indigo-500/20 px-4 py-1 text-xs text-indigo-200 flex justify-between items-center sticky top-0 z-50 backdrop-blur-md">
                        <span>Guest Mode: Data saved to this device only.</span>
                        <button onClick={() => setShowLoginModal(true)} className="hover:text-white underline">Sign up to sync</button>
                    </div>
                )}

                {view === 'dashboard' && stats && <Dashboard user={user} summaries={summaries} notes={notes} stats={stats} onNoteClick={(noteId) => {

                    setView('notes');
                }} />}

                {view === 'summarizer' && (
                    <Summarizer
                        onSave={async (s) => {
                            const sWithUser = { ...s, userId: user.id };
                            const newSums = [sWithUser, ...summaries];
                            setSummaries(newSums);
                            await StorageService.saveSummaries(newSums);
                        }}
                        notes={notes}
                        onAddToNote={handleAddToNote}
                    />
                )}

                {view === 'notes' && (
                    <Notes
                        notes={notes}
                        setNotes={(newNotes) => {
                            setNotes(newNotes);
                            StorageService.saveNotes(newNotes);
                        }}
                        onDeleteNote={async (noteId) => {
                            // strictly handle the flow: Service(Firestore/Storage) -> Local State
                            await StorageService.deleteNote(noteId);
                            setNotes(prev => prev.filter(n => n.id !== noteId));
                            console.log("[DELETE] Removed from local React state:", noteId);
                        }}
                        user={user}
                        onNavigate={setView}
                    />
                )}

                {view === 'routine' && (
                    <Routine
                        user={user}
                        setUser={async (u) => {
                            await StorageService.saveUserProfile(u);
                            setUser(u);
                        }}
                        notes={notes}
                        setNotes={(n) => { setNotes(n); StorageService.saveNotes(n); }}
                        onStartTask={handleStartFocus}
                    />
                )}


                {view === 'quiz' && <QuizPage notes={notes} user={user} stats={stats} setStats={setStats} />}

                {view === 'feed' && (
                    <NoteFeed
                        notes={notes}
                        user={user}
                        onClose={() => setView('dashboard')}
                    />
                )}

                {view === 'store' && (
                    <NotesStore
                        user={user}
                        onImportNote={(newNote) => {
                            setNotes([newNote, ...notes]);
                            StorageService.saveNote(newNote); // Ensure persistence immediately
                            setView('notes');
                        }}
                        onNavigate={setView}
                    />
                )}
            </main>


            {showLoginModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-[#1e1f22] p-8 rounded-2xl w-full max-w-md border border-white/10 shadow-2xl animate-in zoom-in-95">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-2xl font-bold text-white">Sync Account</h2>
                            <button onClick={() => setShowLoginModal(false)} className="text-gray-400 hover:text-white"><X /></button>
                        </div>

                        {authError && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">{authError}</div>}

                        <p className="text-gray-400 mb-6">Create an account to sync your current guest data to the cloud.</p>
                        <input
                            type="email"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#5865F2] mb-4"
                            placeholder="Email"
                            value={emailInput}
                            onChange={(e) => setEmailInput(e.target.value)}
                        />
                        <input
                            type="password"
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#5865F2] mb-6"
                            placeholder="Password"
                            value={passwordInput}
                            onChange={(e) => setPasswordInput(e.target.value)}
                        />
                        <button
                            onClick={handleAuthSubmit}
                            disabled={!emailInput || !passwordInput}
                            className="w-full bg-[#5865F2] hover:bg-[#4752c4] text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50"
                        >
                            {isSignUp ? 'Sign Up & Sync' : 'Sign In & Sync'}
                        </button>
                        <p className="text-center text-sm text-gray-400 mt-4">
                            {isSignUp ? "Already have an account?" : "Don't have an account?"}
                            <button onClick={() => setIsSignUp(!isSignUp)} className="ml-2 text-[#5865F2] hover:underline font-bold">
                                {isSignUp ? 'Sign In' : 'Sign Up'}
                            </button>
                        </p>
                    </div>
                </div>
            )}

        </div>
    );
};

export default App;