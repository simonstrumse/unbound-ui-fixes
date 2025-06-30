// Game Component - v1.1 - Improved UI visibility
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Send, 
  Download, 
  Info, 
  X, 
  RefreshCw, 
  AlertCircle,
  Settings,
  ChevronDown,
  ChevronUp,
  Activity,
  Users,
  MapPin,
  Loader2,
  User,
  Heart,
  MessageCircle,
  Calendar,
  Eye,
  Sparkles
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { supabase, Message, Character, Story, StorySession } from '../lib/supabase';
import { openaiService } from '../lib/openai';
import { validateAndCleanContent } from '../lib/contentCleaner';
import { MemoryEvent, CharacterRelationship, WorldState } from '../lib/types';
import EnhancedExportModal from './EnhancedExportModal';
import ContextProgressBar from './ContextProgressBar';
import AutoSaveIndicator from './AutoSaveIndicator';

// Utility function to validate UUID
const isValidUUID = (uuid: string): boolean => {
  if (!uuid || typeof uuid !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

const Game: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { showNotification } = useNotifications();
  
  // Core state
  const [session, setSession] = useState<StorySession | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Enhanced state
  const [memoryEvents, setMemoryEvents] = useState<MemoryEvent[]>([]);
  const [relationships, setRelationships] = useState<CharacterRelationship[]>([]);
  const [worldState, setWorldState] = useState<WorldState>({
    current_location: '',
    time_of_day: 'morning',
    present_npcs: [],
    mood_atmosphere: '',
    important_objects: []
  });
  
  // UI state
  const [showExportModal, setShowExportModal] = useState(false);
  const [showStoryInfo, setShowStoryInfo] = useState(false);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [storyFreedomOpen, setStoryFreedomOpen] = useState(false);
  
  // Mobile responsive state
  const [isMobile, setIsMobile] = useState(false);
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Check mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setLeftSidebarCollapsed(true);
        setRightSidebarCollapsed(true);
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!sessionId || !user) return;

    console.log('Setting up realtime subscription for session:', sessionId);

    const channel = supabase.channel(`game:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `session_id=eq.${sessionId}`
        },
        (payload) => {
          console.log('New message received:', payload);
          const newMessage = payload.new as Message;
          
          // Only add if it's not from us and not already in the list
          if (newMessage.user_id !== user.id && !messages.find(m => m.id === newMessage.id)) {
            setMessages(prev => [...prev, newMessage]);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'story_sessions',
          filter: `id=eq.${sessionId}`
        },
        (payload) => {
          console.log('Session updated:', payload);
          const updatedSession = payload.new as StorySession;
          setSession(updatedSession);
          
          // Update state from session
          if (updatedSession.session_state) {
            const state = updatedSession.session_state;
            if (state.memory_events) setMemoryEvents(state.memory_events);
            if (state.character_relationships) setRelationships(state.character_relationships);
            if (state.world_state) setWorldState(state.world_state);
          }
        }
      )
      .subscribe();

    return () => {
      console.log('Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [sessionId, user, messages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Toggle functions
  const toggleLeftSidebar = () => setLeftSidebarCollapsed(!leftSidebarCollapsed);
  const toggleRightSidebar = () => setRightSidebarCollapsed(!rightSidebarCollapsed);

  // Load session data
  useEffect(() => {
    if (!sessionId || !isValidUUID(sessionId)) {
      console.error('Invalid session ID:', sessionId);
      setError('Invalid session ID');
      setLoading(false);
      return;
    }

    if (!user) {
      console.error('No user found');
      setError('Please sign in to continue');
      setLoading(false);
      return;
    }

    loadSessionData();
  }, [sessionId, user]);

  const loadSessionData = async () => {
    if (!sessionId || !user) return;

    try {
      setLoading(true);
      setError(null);

      console.log('Loading session data for:', sessionId);

      // Load session with related data
      const { data: sessionData, error: sessionError } = await supabase
        .from('story_sessions')
        .select(`
          *,
          stories (*),
          characters (*)
        `)
        .eq('id', sessionId)
        .eq('user_id', user.id)
        .single();

      if (sessionError || !sessionData) {
        console.error('Failed to load session:', sessionError);
        setError('Session not found or you don\'t have access to it');
        return;
      }

      console.log('Session loaded:', sessionData);

      // Set the data
      setSession(sessionData);
      setStory(sessionData.stories);
      setCharacter(sessionData.characters);
      
      // Load state from session
      if (sessionData.session_state) {
        const state = sessionData.session_state;
        if (state.memory_events) setMemoryEvents(state.memory_events);
        if (state.character_relationships) setRelationships(state.character_relationships);
        if (state.world_state) setWorldState(state.world_state);
      }

      // Load messages
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (messagesError) {
        console.error('Failed to load messages:', messagesError);
      } else {
        console.log('Messages loaded:', messagesData?.length || 0);
        setMessages(messagesData || []);
      }

    } catch (err) {
      console.error('Error loading session:', err);
      setError('Failed to load game session');
    } finally {
      setLoading(false);
    }
  };

  const handleCreativityLevelChange = useCallback(async (newLevel: 'faithful' | 'balanced' | 'creative') => {
    if (!session || !user || session.creativity_level === newLevel) {
      setStoryFreedomOpen(false);
      return;
    }

    try {
      console.log('Updating creativity level to:', newLevel);

      const { error } = await supabase
        .from('story_sessions')
        .update({ 
          creativity_level: newLevel,
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id)
        .eq('user_id', user.id);

      if (error) throw error;

      setSession({ ...session, creativity_level: newLevel });
      setStoryFreedomOpen(false);
      showNotification(`Story freedom changed to ${getCreativityLevelDisplay(newLevel).name}`, 'success');

    } catch (err) {
      console.error('Error updating creativity level:', err);
      showNotification('Failed to update story freedom', 'error');
    }
  }, [session, user, showNotification]);

  const getCreativityLevelDisplay = (level?: 'faithful' | 'balanced' | 'creative') => {
    const currentLevel = level || session?.creativity_level || 'balanced';
    
    switch (currentLevel) {
      case 'faithful':
        return {
          name: 'Story-Focused',
          description: 'Staying true to the original narrative',
          icon: '📖'
        };
      case 'balanced':
        return {
          name: 'Flexible Exploration',
          description: 'Balanced adventure with creative possibilities',
          icon: '⚖️'
        };
      case 'creative':
        return {
          name: 'Open World',
          description: 'Complete creative freedom',
          icon: '🚀'
        };
      default:
        return {
          name: 'Flexible Exploration',
          description: 'Balanced adventure with creative possibilities',
          icon: '⚖️'
        };
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !session || !character || !story || !user || sending) return;

    const userMessage = input.trim();
    setInput('');
    setSending(true);

    try {
      // Create user message
      const { data: newUserMessage, error: userError } = await supabase
        .from('messages')
        .insert({
          session_id: session.id,
          user_id: user.id,
          content: userMessage,
          is_user: true,
          order_index: messages.length
        })
        .select()
        .single();

      if (userError) throw userError;

      // Update local state immediately
      setMessages(prev => [...prev, newUserMessage]);

      // Call AI service
      console.log('Calling OpenAI service...');
      const result = await openaiService.generateStoryResponse({
        messages: [...messages, newUserMessage],
        story,
        character,
        session,
        memoryEvents,
        relationships,
        worldState
      });

      console.log('AI response received:', result);

      // Validate and clean the content
      const cleanedContent = validateAndCleanContent(result.content);

      // Create AI message
      const { data: aiMessage, error: aiError } = await supabase
        .from('messages')
        .insert({
          session_id: session.id,
          user_id: user.id,
          content: cleanedContent,
          is_user: false,
          order_index: messages.length + 1
        })
        .select()
        .single();

      if (aiError) throw aiError;

      setMessages(prev => [...prev, aiMessage]);

      // Update session state with new context info
      const updatedState = {
        ...session.session_state,
        memory_events: result.memoryEvents || memoryEvents,
        character_relationships: result.relationships || relationships,
        world_state: result.worldState || worldState,
        context_tokens_used: result.tokensUsed || 0,
        last_summary: result.summary || session.session_state?.last_summary,
        important_decisions: result.importantDecisions || session.session_state?.important_decisions || []
      };

      // Update local state
      if (result.memoryEvents) setMemoryEvents(result.memoryEvents);
      if (result.relationships) setRelationships(result.relationships);
      if (result.worldState) setWorldState(result.worldState);

      // Update session in database
      const { error: updateError } = await supabase
        .from('story_sessions')
        .update({
          session_state: updatedState,
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id);

      if (updateError) {
        console.error('Failed to update session state:', updateError);
      }

      // Update API usage tracking
      if (result.tokensUsed > 0) {
        await supabase
          .from('api_usage')
          .insert({
            user_id: user.id,
            session_id: session.id,
            operation_type: 'story_response',
            model_type: 'gpt-4o-mini',
            tokens_used: result.tokensUsed,
            cost_estimate: result.tokensUsed * 0.00003, // Rough estimate
            response_time_ms: result.responseTime || 0
          });
      }

      // Trigger auto-save
      setAutoSaveStatus('saving');
      setTimeout(() => setAutoSaveStatus('saved'), 1000);
      setTimeout(() => setAutoSaveStatus('idle'), 3000);

    } catch (err) {
      console.error('Error sending message:', err);
      showNotification('Failed to send message. Please try again.', 'error');
      // Restore the input
      setInput(userMessage);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const regenerateLastResponse = async () => {
    if (!session || messages.length < 2 || sending) return;

    // Find the last AI message
    const lastAiMessageIndex = messages.findLastIndex(m => !m.is_user);
    if (lastAiMessageIndex === -1) return;

    setSending(true);
    
    try {
      // Get messages up to (but not including) the last AI message
      const previousMessages = messages.slice(0, lastAiMessageIndex);
      
      // Call AI service again
      const result = await openaiService.generateStoryResponse({
        messages: previousMessages,
        story: story!,
        character: character!,
        session,
        memoryEvents,
        relationships,
        worldState,
        regenerate: true
      });

      // Validate and clean the content
      const cleanedContent = validateAndCleanContent(result.content);

      // Update the last AI message
      const { error: updateError } = await supabase
        .from('messages')
        .update({
          content: cleanedContent,
          updated_at: new Date().toISOString()
        })
        .eq('id', messages[lastAiMessageIndex].id);

      if (updateError) throw updateError;

      // Update local state
      const updatedMessages = [...messages];
      updatedMessages[lastAiMessageIndex] = {
        ...updatedMessages[lastAiMessageIndex],
        content: cleanedContent
      };
      setMessages(updatedMessages);

      showNotification('Response regenerated', 'success');
    } catch (err) {
      console.error('Error regenerating response:', err);
      showNotification('Failed to regenerate response', 'error');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-white animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading your adventure...</p>
        </div>
      </div>
    );
  }

  if (error || !session || !story || !character) {
    return (
      <div className="h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-slate-900 flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Unable to Load Game</h2>
          <p className="text-purple-200 mb-6">{error || 'Failed to load game session'}</p>
          <Link
            to="/dashboard"
            className="bg-white text-purple-900 px-6 py-3 rounded-lg font-medium hover:bg-purple-50 transition-colors inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const avatarColorIndex = parseInt(character.avatar_url?.split('-')[1] || '0');
  const currentContextUsage = session.session_state?.context_tokens_used || 0;
  const creativityDisplay = getCreativityLevelDisplay();

  return (
    <div className="h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-slate-900 flex flex-col overflow-hidden game-chat">
      {/* Header */}
      <header className="bg-white/20 backdrop-blur-sm border-b border-white/30 flex-shrink-0">
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to="/dashboard"
                className="flex items-center gap-2 text-white hover:text-purple-200 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                Back
              </Link>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium text-white">
                    {character.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-white">{character.name}</h1>
                  <p className="text-sm text-purple-200">{story.title}</p>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Mobile menu buttons */}
              {isMobile && (
                <>
                  <button
                    onClick={toggleLeftSidebar}
                    className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors"
                  >
                    <User className="w-5 h-5" />
                  </button>
                  <button
                    onClick={toggleRightSidebar}
                    className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg transition-colors"
                  >
                    <Activity className="w-5 h-5" />
                  </button>
                </>
              )}
              
              {/* Action buttons */}
              <button
                onClick={() => setShowExportModal(true)}
                className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                {!isMobile && 'Export'}
              </button>
              <button
                onClick={() => setShowStoryInfo(!showStoryInfo)}
                className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                <Info className="w-4 h-4" />
                {!isMobile && 'Info'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Character Info */}
        <div className={`bg-white/20 backdrop-blur-sm border-r border-white/30 flex-shrink-0 transition-all duration-300 ${
          leftSidebarCollapsed ? (isMobile ? 'w-0' : 'w-0') : 'w-80'
        } ${leftSidebarCollapsed ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div className="p-6 space-y-6">
            {/* Character Header */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-white">Character Info</h3>
                {!isMobile && (
                  <button
                    onClick={toggleLeftSidebar}
                    className="text-purple-200 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                  <span className="text-xl font-medium text-white">
                    {character.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-white">{character.name}</p>
                  <p className="text-sm text-purple-200">Level {character.level || 1}</p>
                </div>
              </div>
            </div>

            {/* Traits */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <h4 className="text-white font-medium mb-3">Traits</h4>
              <div className="space-y-2">
                {character.traits.map((trait, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className="text-purple-300 mt-1">•</span>
                    <span className="text-purple-100 text-sm">{trait}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Relationships */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <div className="flex items-center gap-2 mb-3">
                <Heart className="w-5 h-5 text-purple-300" />
                <h4 className="text-white font-medium">Relationships</h4>
              </div>
              <div className="space-y-2">
                {relationships.length > 0 ? (
                  relationships.map((rel, index) => (
                    <div key={index} className="text-sm">
                      <span className="text-purple-100">{rel.character_name}</span>
                      <span className="text-purple-200 ml-2">• {rel.relationship_level}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-purple-200 text-sm">No relationships formed yet</p>
                )}
              </div>
            </div>

            {/* Memory Events */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-5 h-5 text-purple-300" />
                <h4 className="text-white font-medium">Key Memories</h4>
              </div>
              <div className="space-y-2">
                {memoryEvents.slice(-5).map((event, index) => (
                  <div key={index} className="text-sm">
                    <p className="text-purple-100">{event.event_type}</p>
                    <p className="text-purple-200 text-xs">{event.description}</p>
                  </div>
                ))}
                {memoryEvents.length === 0 && (
                  <p className="text-purple-200 text-sm">No memories yet</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Center - Main Chat Area */}
        <div className="flex-1 flex flex-col bg-transparent">
          {/* Story info panel */}
          {showStoryInfo && (
            <div className="bg-white/10 backdrop-blur-sm border-b border-white/20 p-4">
              <div className="max-w-4xl mx-auto">
                <h3 className="text-lg font-medium text-white mb-2">{story.title}</h3>
                <p className="text-purple-200 text-sm mb-3">{story.description}</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="text-purple-300">Genre: {story.genre}</span>
                  <span className="text-purple-300">Setting: {story.setting}</span>
                  <span className="text-purple-300">Tone: {story.tone}</span>
                  <span className="text-purple-300">Perspective: {story.perspective}</span>
                </div>
              </div>
            </div>
          )}

          {/* Messages area */}
          <div 
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-4"
          >
            <div className="max-w-4xl mx-auto">
              {messages.map((message, index) => (
                <div
                  key={message.id}
                  className={`flex ${message.is_user ? 'justify-end' : 'justify-start'} mb-4`}
                >
                  <div className={`max-w-[80%] ${message.is_user ? 'order-2' : 'order-1'}`}>
                    <div className={`rounded-lg p-4 ${
                      message.is_user
                        ? 'bg-purple-600 text-white'
                        : 'bg-white/90 text-gray-800 backdrop-blur-sm'
                    }`}>
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    </div>
                    <div className={`text-xs mt-1 ${
                      message.is_user ? 'text-right text-purple-200' : 'text-left text-purple-300'
                    }`}>
                      {new Date(message.created_at).toLocaleTimeString([], { 
                        hour: 'numeric', 
                        minute: '2-digit' 
                      })}
                    </div>
                  </div>
                </div>
              ))}
              
              {sending && (
                <div className="flex justify-start mb-4">
                  <div className="bg-white/90 backdrop-blur-sm rounded-lg p-4">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                      <span className="text-gray-600">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Suggested actions */}
          {!sending && messages.length > 0 && !messages[messages.length - 1].is_user && (
            <div className="px-4 pb-2">
              <div className="max-w-4xl mx-auto">
                <div className="flex flex-wrap gap-2">
                  {/* These could be dynamic based on context */}
                  <button
                    onClick={() => setInput('Look around')}
                    className="bg-white/10 hover:bg-white/20 text-purple-100 px-3 py-1 rounded text-sm transition-colors border border-white/20"
                  >
                    Look around
                  </button>
                  <button
                    onClick={() => setInput('Who else is here?')}
                    className="bg-white/10 hover:bg-white/20 text-purple-100 px-3 py-1 rounded text-sm transition-colors border border-white/20"
                  >
                    Who's here?
                  </button>
                  <button
                    onClick={() => setInput('What should I do next?')}
                    className="bg-white/10 hover:bg-white/20 text-purple-100 px-3 py-1 rounded text-sm transition-colors border border-white/20"
                  >
                    What next?
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-white/20 bg-white/10 backdrop-blur-sm p-4">
            <div className="max-w-4xl mx-auto">
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="What would you like to do?"
                  className="flex-1 bg-white/90 backdrop-blur-sm text-gray-800 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-500"
                  rows={1}
                  disabled={sending}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || sending}
                  className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg px-6 py-3 transition-colors flex items-center gap-2"
                >
                  {sending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
                {messages.length > 0 && !messages[messages.length - 1].is_user && !sending && (
                  <button
                    onClick={regenerateLastResponse}
                    className="bg-white/10 hover:bg-white/20 text-white rounded-lg px-4 py-3 transition-colors"
                    title="Regenerate last response"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Game Status */}
        <div className={`bg-white/20 backdrop-blur-sm border-l border-white/20 flex-shrink-0 transition-all duration-300 ${
          rightSidebarCollapsed ? (isMobile ? 'w-0' : 'w-0') : 'w-80'
        } ${rightSidebarCollapsed ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div className="p-6 space-y-6">
            {/* Game Status Header */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-white">Game Status</h3>
                {!isMobile && (
                  <button
                    onClick={toggleRightSidebar}
                    className="text-purple-200 hover:text-white transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Context Usage */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-purple-300" />
                <h4 className="text-white font-medium">Context Usage</h4>
              </div>
              <ContextProgressBar 
                tokensUsed={currentContextUsage}
                className="mb-2"
              />
              <p className="text-purple-200 text-xs font-light">
                Context usage healthy • {currentContextUsage.toLocaleString()} tokens
              </p>
            </div>

            {/* Current Scene */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <div className="flex items-center gap-2 mb-4">
                <MapPin className="w-5 h-5 text-purple-300" />
                <h4 className="text-white font-medium">Current Scene</h4>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="text-purple-200 text-sm font-medium">Time:</span>
                  <span className="text-purple-100 text-sm font-light ml-2">
                    {worldState.time_of_day}
                  </span>
                </div>
                <div>
                  <span className="text-purple-200 text-sm font-medium">Mood:</span>
                  <span className="text-purple-100 text-sm font-light ml-2">
                    {worldState.mood_atmosphere || 'exploring, vibrant, curious'}
                  </span>
                </div>
                <div>
                  <span className="text-purple-200 text-sm font-medium">Location:</span>
                  <span className="text-purple-100 text-sm font-light ml-2">
                    {worldState.current_location || 'Meryton village green'}
                  </span>
                </div>
              </div>
            </div>

            {/* Characters Present */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-300" />
                  <h4 className="text-white font-medium">Characters Present</h4>
                </div>
                <span className="text-white font-medium">
                  {worldState.present_npcs?.length || 2}
                </span>
              </div>
              <div className="space-y-2">
                {(worldState.present_npcs && worldState.present_npcs.length > 0 ? 
                  worldState.present_npcs : ['Miss Bingley', 'Miss Bennet']
                ).map((npc, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center">
                      <span className="text-xs font-medium text-white">
                        {npc.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-purple-100 text-sm font-light">{npc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Story Freedom */}
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="w-5 h-5 text-purple-300" />
                <h4 className="text-white font-medium">Story Freedom</h4>
              </div>
              <div className="relative">
                <button
                  onClick={() => setStoryFreedomOpen(!storyFreedomOpen)}
                  className="w-full p-3 bg-white/20 border border-white/30 rounded text-left text-white hover:bg-white/30 transition-colors flex items-center justify-between cursor-pointer"
                >
                  <div>
                    <div className="font-medium">{creativityDisplay.name}</div>
                    <div className="text-sm text-purple-200 font-light">{creativityDisplay.description}</div>
                  </div>
                  {storyFreedomOpen ? 
                    <ChevronUp className="w-4 h-4 text-purple-300" /> : 
                    <ChevronDown className="w-4 h-4 text-purple-300" />
                  }
                </button>
                
                {storyFreedomOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white/20 backdrop-blur-sm border border-white/30 rounded-lg z-10 shadow-xl">
                    {[
                      { key: 'faithful', name: 'Story-Focused', description: 'Staying true to the original narrative' },
                      { key: 'balanced', name: 'Flexible Exploration', description: 'Balanced adventure with creative possibilities' },
                      { key: 'creative', name: 'Open World', description: 'Complete creative freedom' }
                    ].map((option) => (
                      <button
                        key={option.key}
                        onClick={() => handleCreativityLevelChange(option.key as any)}
                        className="w-full p-3 text-left text-white hover:bg-white/20 transition-colors first:rounded-t-lg last:rounded-b-lg border-b border-white/20 last:border-b-0 cursor-pointer"
                      >
                        <div className="font-medium">{option.name}</div>
                        <div className="text-sm text-purple-200 font-light">{option.description}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <EnhancedExportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          messages={messages}
          storyTitle={story.title}
          characterName={character.name}
          memoryEvents={memoryEvents}
          relationships={relationships}
          worldState={worldState}
        />
      )}

      {/* Auto-save indicator */}
      <AutoSaveIndicator status={autoSaveStatus} />
    </div>
  );
};

export default Game;