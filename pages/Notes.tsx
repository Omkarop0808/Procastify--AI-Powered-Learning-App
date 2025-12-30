import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Note, NoteElement, UserPreferences } from '../types';
import { Plus, ChevronLeft, Trash2, StickyNote, Search, MousePointer2, Hand, AlignLeft, Type as TypeIcon, GripHorizontal } from 'lucide-react';

interface NotesProps {
  notes: Note[];
  setNotes: (notes: Note[]) => void;
  user: UserPreferences;
}


const STICKY_COLORS = ['#fef3c7', '#dbeafe', '#dcfce7', '#f3e8ff']; // Amber, Blue, Green, Purple
const DEFAULT_TEXT_WIDTH = 400;
const DEFAULT_STICKY_WIDTH = 240;

const getFontSizeClass = (size?: string) => {
    switch(size) {
        case 'small': return 'text-sm text-white/70';
        case 'large': return 'text-2xl font-bold text-white';
        default: return 'text-base text-white/90'; // medium
    }
};


const AutoResizingTextarea = ({ 
    element, 
    updateElement, 
    removeElement, 
    addElement, 
    isEditing, 
    setEditingId 
}: { 
    element: NoteElement; 
    updateElement: (id: string, updates: Partial<NoteElement>) => void;
    removeElement: (id: string) => void;
    addElement: (type: NoteElement['type'], x: number, y: number, content?: string) => void;
    isEditing: boolean;
    setEditingId: (id: string | null) => void;
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    
    
    useLayoutEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
            // Only update state if significantly different to avoid loop
            if (Math.abs((element.height || 0) - textareaRef.current.scrollHeight) > 2) {
                updateElement(element.id, { height: textareaRef.current.scrollHeight });
            }
        }
    }, [element.content, element.fontSize, isEditing]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const newY = element.y + (element.height || 40) + 16;
            addElement('text', element.x, newY);
        }
        if (e.key === 'Backspace' && !element.content) {
            
            removeElement(element.id);
        }
    };

    const fontSizeClass = getFontSizeClass(element.fontSize);

    if (!isEditing) {
         return (
            <div 
                className={`w-full p-1 leading-relaxed whitespace-pre-wrap cursor-text ${fontSizeClass} ${!element.content ? 'text-white/20 italic' : ''}`}
                style={{ minHeight: '40px' }}
            >
                {element.content || 'Empty block'}
            </div>
         );
    }

    return (
        <textarea 
            ref={textareaRef}
            autoFocus
            className={`w-full bg-transparent resize-none focus:outline-none font-sans overflow-hidden p-1 leading-relaxed ${fontSizeClass}`}
            placeholder="Type something..."
            value={element.content || ''}
            onChange={(e) => updateElement(element.id, { content: e.target.value })}
            onKeyDown={handleKeyDown}
            onBlur={() => setEditingId(null)}
            onMouseDown={(e) => e.stopPropagation()} // Allow text selection without dragging
        />
    );
};

const Notes: React.FC<NotesProps> = ({ notes, setNotes, user }) => {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  
  
  const [tool, setTool] = useState<'select' | 'hand' | 'text' | 'sticky'>('select');
  
  
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  
  const [draggedElementId, setDraggedElementId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 }); // To distinguish click vs drag

  
  const [search, setSearch] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  
  const activeNote = notes.find(n => n.id === selectedNoteId);

  
  const getCanvasCoords = (e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return {
          x: (e.clientX - rect.left - view.x) / view.scale,
          y: (e.clientY - rect.top - view.y) / view.scale
      };
  };

  const cycleFontSize = (elId: string, currentSize?: 'small' | 'medium' | 'large') => {
      let nextSize: 'small' | 'medium' | 'large' = 'medium';
      if (currentSize === 'medium') nextSize = 'large';
      if (currentSize === 'large') nextSize = 'small';
      updateElement(elId, { fontSize: nextSize });
  };

  
  const createNote = () => {
      const newNote: Note = {
          id: Date.now().toString(),
          userId: user.id,
          title: 'Untitled Note',
          elements: [],
          tags: [],
          folder: 'General',
          lastModified: Date.now()
      };
      setNotes([newNote, ...notes]);
      setSelectedNoteId(newNote.id);
      setView({ x: 0, y: 0, scale: 1 });
  };

  const deleteNote = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setNotes(notes.filter(n => n.id !== id));
      if(selectedNoteId === id) setSelectedNoteId(null);
  };

  const addElement = (type: NoteElement['type'], x: number, y: number, content: string = '') => {
      if(!selectedNoteId) return;
      
      const newEl: NoteElement = {
          id: Date.now().toString(),
          type,
          x,
          y,
          width: type === 'text' ? DEFAULT_TEXT_WIDTH : DEFAULT_STICKY_WIDTH,
          height: type === 'text' ? 40 : 240, 
          content: content,
          color: type === 'sticky' ? STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)] : undefined,
          zIndex: (activeNote?.elements.length || 0) + 1,
          fontSize: 'medium'
      };

      const updatedElements = [...(activeNote?.elements || []), newEl];
      setNotes(notes.map(n => n.id === selectedNoteId ? { ...n, elements: updatedElements } : n));
      
      
      if (type === 'text' || type === 'sticky') {
          setEditingElementId(newEl.id);
          setSelectedElementId(newEl.id);
          setTool('select');
      }
  };

  const updateElement = (elId: string, changes: Partial<NoteElement>) => {
      if(!selectedNoteId) return;
      const updatedElements = activeNote?.elements.map(el => el.id === elId ? { ...el, ...changes } : el) || [];
      setNotes(notes.map(n => n.id === selectedNoteId ? { ...n, elements: updatedElements } : n));
  };

  const removeElement = (elId: string) => {
      if(!selectedNoteId) return;
      const updatedElements = activeNote?.elements.filter(el => 
          el.id !== elId 
      ) || [];
      setNotes(notes.map(n => n.id === selectedNoteId ? { ...n, elements: updatedElements } : n));
      setSelectedElementId(null);
      setEditingElementId(null);
  };

  

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
      
      
      if (tool === 'hand' || e.button === 1) {
          setIsPanning(true);
          setPanStart({ x: e.clientX - view.x, y: e.clientY - view.y });
          return;
      } 
      
      if (tool === 'text' || tool === 'sticky') {
          const coords = getCanvasCoords(e);
          addElement(tool, coords.x, coords.y);
          return;
      }
      
      if (tool === 'select') {
          setSelectedElementId(null);
          setEditingElementId(null);
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (isPanning) {
          setView({ ...view, x: e.clientX - panStart.x, y: e.clientY - panStart.y });
          return;
      }

      if (draggedElementId && tool === 'select') {
          const mouseCanvasX = (e.clientX - view.x) / view.scale;
          const mouseCanvasY = (e.clientY - view.y) / view.scale;
          
          updateElement(draggedElementId, {
              x: mouseCanvasX - dragOffset.x,
              y: mouseCanvasY - dragOffset.y
          });
      }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
      
      if (draggedElementId && tool === 'select') {
          const dist = Math.hypot(e.clientX - dragStartPos.x, e.clientY - dragStartPos.y);
          
          if (dist < 5) {
             const el = activeNote?.elements.find(x => x.id === draggedElementId);
             if (el && (el.type === 'text' || el.type === 'sticky')) {
                 setEditingElementId(draggedElementId);
             }
          }
      }

      setIsPanning(false);
      setDraggedElementId(null);
  };

  const handleElementMouseDown = (e: React.MouseEvent, elId: string, elX: number, elY: number) => {
      e.stopPropagation();

      
      if (editingElementId === elId) return;

      if (tool === 'select') {
          setSelectedElementId(elId);
          setDraggedElementId(elId);
          
          const mouseCanvasX = (e.clientX - view.x) / view.scale;
          const mouseCanvasY = (e.clientY - view.y) / view.scale;
          setDragOffset({ x: mouseCanvasX - elX, y: mouseCanvasY - elY });
          
          
          setDragStartPos({ x: e.clientX, y: e.clientY });
      }
  };

  
  if (!selectedNoteId) {
    return (
      <div className="p-8 h-full overflow-y-auto">
        <div className="flex justify-between items-center mb-8 max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-white">Notes Canvas</h1>
          <button onClick={createNote} className="bg-discord-accent hover:bg-discord-accentHover text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors font-medium">
            <Plus size={18} /> New Canvas
          </button>
        </div>
        
        <div className="mb-6 relative max-w-6xl mx-auto">
            <Search className="absolute left-3 top-3 text-discord-textMuted" size={20} />
            <input 
                className="w-full bg-discord-panel border border-white/5 rounded-lg pl-10 pr-4 py-3 text-white focus:outline-none focus:border-discord-accent transition-all"
                placeholder="Search your notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {notes.filter(n => n.title.toLowerCase().includes(search.toLowerCase())).map(note => (
            <div 
              key={note.id}
              onClick={() => setSelectedNoteId(note.id)}
              className="bg-discord-panel aspect-video rounded-xl border border-white/5 hover:border-discord-accent/50 cursor-pointer transition-all group relative overflow-hidden shadow-sm hover:shadow-md"
            >
               
               <div className="absolute inset-0 p-4 opacity-40 pointer-events-none scale-[0.3] origin-top-left w-[333%] h-[333%] overflow-hidden bg-[#1e1f22]">
                    <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                    {note.elements.filter(el => el.type !== 'arrow').slice(0, 10).map(el => (
                        <div key={el.id} style={{
                            position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height,
                            backgroundColor: el.type === 'text' ? 'rgba(255,255,255,0.05)' : (el.color || '#333'),
                            border: el.type === 'text' ? 'none' : '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '4px'
                        }}></div>
                    ))}
               </div>
               
               <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-[#111] via-[#111]/80 to-transparent p-5 pt-16">
                   <h3 className="font-bold text-lg text-white truncate">{note.title}</h3>
                   <div className="flex items-center gap-2 mt-1">
                       <span className="text-xs text-discord-textMuted">{note.elements.length} blocks</span>
                       <span className="text-xs text-discord-textMuted">•</span>
                       <span className="text-xs text-discord-textMuted">{new Date(note.lastModified).toLocaleDateString()}</span>
                   </div>
               </div>

               <button onClick={(e) => deleteNote(note.id, e)} className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-red-500 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm">
                   <Trash2 size={16} />
               </button>
            </div>
          ))}
          {notes.length === 0 && (
              <div className="col-span-full text-center py-20 opacity-50">
                  <AlignLeft size={48} className="mx-auto mb-4" />
                  <p>Create a canvas to start thinking.</p>
              </div>
          )}
        </div>
      </div>
    );
  }

  
  if (!activeNote) {
      setTimeout(() => setSelectedNoteId(null), 0);
      return null;
  }

  
  return (
    <div className="h-screen flex flex-col bg-[#1e1f22] overflow-hidden">
      
      <div className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-discord-panel shrink-0 z-50 shadow-sm relative">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelectedNoteId(null)} className="text-discord-textMuted hover:text-white transition-colors p-2 hover:bg-white/5 rounded-lg">
            <ChevronLeft size={20} />
          </button>
          <div className="h-6 w-[1px] bg-white/10"></div>
          
          
          <div className="group relative flex items-center">
              <input 
                value={activeNote.title}
                onChange={(e) => setNotes(notes.map(n => n.id === activeNote.id ? {...n, title: e.target.value} : n))}
                onFocus={() => setIsEditingTitle(true)}
                onBlur={() => setIsEditingTitle(false)}
                className={`bg-transparent text-white font-bold text-xl focus:outline-none w-64 px-3 py-1.5 rounded-lg transition-all border border-transparent
                    ${isEditingTitle ? 'bg-black/20 border-white/10' : 'hover:bg-white/5 hover:border-white/5'}
                `}
                placeholder="Untitled Note"
              />
          </div>
        </div>
        
        
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 bg-[#111] p-1.5 rounded-xl border border-white/10 shadow-xl">
            {[
                { t: 'select', i: MousePointer2, label: 'Select (V)' },
                { t: 'hand', i: Hand, label: 'Pan (H)' },
                { t: 'text', i: TypeIcon, label: 'Text Block' },
                { t: 'sticky', i: StickyNote, label: 'Post-it' },
            ].map((item) => (
                <button
                    key={item.t}
                    onClick={() => setTool(item.t as any)}
                    title={item.label}
                    className={`p-2 rounded-lg transition-all relative ${tool === item.t ? 'bg-discord-accent text-white shadow-sm' : 'text-discord-textMuted hover:text-white hover:bg-white/10'}`}
                >
                    <item.i size={18} />
                </button>
            ))}
        </div>
        
        <div className="text-xs font-mono text-discord-textMuted w-24 text-right opacity-50">
            {Math.round(view.scale * 100)}%
        </div>
      </div>

      
      <div 
        className={`flex-1 relative overflow-hidden bg-[#1e1f22] ${tool === 'hand' || isPanning ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        
        <div 
            className="absolute inset-0 pointer-events-none opacity-[0.08]"
            style={{
                backgroundImage: 'radial-gradient(#fff 1.5px, transparent 1.5px)',
                backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
                backgroundPosition: `${view.x}px ${view.y}px`
            }}
        />

        <div 
            style={{ 
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                transformOrigin: '0 0',
                width: '100%', height: '100%'
            }}
        >
            
            {activeNote.elements.filter(el => el.type !== 'arrow').map(el => {
                const isSelected = selectedElementId === el.id;
                const isEditing = editingElementId === el.id;
                
                return (
                    <div
                        key={el.id}
                        onMouseDown={(e) => handleElementMouseDown(e, el.id, el.x, el.y)}
                        style={{
                            position: 'absolute',
                            left: el.x,
                            top: el.y,
                            width: el.width,
                            zIndex: el.zIndex,
                            backgroundColor: el.type === 'sticky' ? el.color : 'transparent',
                            boxShadow: draggedElementId === el.id ? '0 10px 30px -10px rgba(0,0,0,0.5)' : el.type === 'sticky' ? '0 4px 6px -1px rgba(0,0,0,0.1)' : 'none',
                            outline: isSelected && !isEditing ? (el.type === 'text' ? '2px dashed rgba(255,255,255,0.2)' : '2px solid #5865F2') : 'none',
                            outlineOffset: '4px',
                            borderRadius: el.type === 'sticky' ? '2px' : '4px',
                            cursor: tool === 'select' ? 'move' : 'text'
                        }}
                        className={`group transition-shadow duration-200 ${el.type === 'sticky' ? 'hover:shadow-lg' : ''}`}
                    >
                        
                        {(isSelected || isEditing) && el.type === 'text' && (
                            <div className="absolute -top-10 left-0 bg-discord-panel border border-white/10 rounded-lg flex items-center p-1 shadow-xl z-50 animate-in fade-in zoom-in-95 pointer-events-auto" onMouseDown={(e) => e.stopPropagation()}>
                                <button onClick={() => cycleFontSize(el.id, el.fontSize)} className="p-1.5 hover:bg-white/10 rounded text-xs font-bold text-white flex items-center gap-1">
                                    <TypeIcon size={14} />
                                    {el.fontSize === 'small' ? 'Sm' : el.fontSize === 'large' ? 'Lg' : 'Md'}
                                </button>
                                <div className="w-[1px] h-4 bg-white/10 mx-1"></div>
                                <button onClick={() => removeElement(el.id)} className="p-1.5 hover:bg-red-500/20 text-red-400 rounded">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        )}

                         
                         {(isSelected || isEditing) && el.type === 'sticky' && (
                            <div className="absolute -top-10 left-0 bg-discord-panel border border-white/10 rounded-lg flex items-center p-1 shadow-xl z-50 animate-in fade-in zoom-in-95 pointer-events-auto" onMouseDown={(e) => e.stopPropagation()}>
                                <button onClick={() => updateElement(el.id, {color: STICKY_COLORS[Math.floor(Math.random() * STICKY_COLORS.length)]})} className="p-1.5 hover:bg-white/10 rounded text-xs font-bold text-white flex items-center gap-1">
                                    <span className="w-3 h-3 rounded-full" style={{backgroundColor: el.color}}></span> Color
                                </button>
                                <div className="w-[1px] h-4 bg-white/10 mx-1"></div>
                                <button onClick={() => removeElement(el.id)} className="p-1.5 hover:bg-red-500/20 text-red-400 rounded">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        )}

                        
                        {(el.type === 'text' || el.type === 'summary_card') && (
                            <AutoResizingTextarea 
                                element={el}
                                updateElement={updateElement}
                                removeElement={removeElement}
                                addElement={addElement}
                                isEditing={isEditing}
                                setEditingId={setEditingElementId}
                            />
                        )}

                        
                        {el.type === 'sticky' && (
                            <div className="w-full h-full p-4 flex flex-col min-h-[160px]">
                                {isEditing ? (
                                    <textarea 
                                        autoFocus
                                        className="w-full h-full bg-transparent resize-none focus:outline-none font-sans text-gray-800 text-sm leading-relaxed"
                                        value={el.content}
                                        placeholder="Note..."
                                        onChange={(e) => updateElement(el.id, { content: e.target.value })}
                                        onKeyDown={(e) => e.key === 'Backspace' && !el.content && removeElement(el.id)}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onBlur={() => setEditingElementId(null)}
                                    />
                                ) : (
                                    <div className="w-full h-full text-gray-800 text-sm leading-relaxed whitespace-pre-wrap cursor-text">
                                        {el.content || 'Empty note'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
      </div>
    </div>
  );
};

export default Notes;
