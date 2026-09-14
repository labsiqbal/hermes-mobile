import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

/** Only final speech enters the draft. No recording is submitted to Hermes. */
export function DictationButton({disabled,draft,onTranscript,onStatus}:{disabled:boolean;draft:string;onTranscript:(text:string)=>void;onStatus:(text:string)=>void}) {
  const recognition=useRef<Recognition | null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const [listening,setListening]=useState(false);
  const [consented,setConsented]=useState(false);
  const [confirm,setConfirm]=useState(false);
  const transcriptRef=useRef(onTranscript), statusRef=useRef(onStatus);
  useEffect(()=>{transcriptRef.current=onTranscript;statusRef.current=onStatus;},[onTranscript,onStatus]);
  useEffect(()=>{
    return ()=>{
      const active=recognition.current;
      recognition.current=null;
      if(active){active.onresult=null;active.onerror=null;active.onend=null;active.abort();}
    };
  },[disabled,draft]);
  useEffect(()=>{
    if(!recognition.current) {
      queueMicrotask(()=>setListening(false));
    }
    if(disabled) {dialog.current?.close();queueMicrotask(()=>setConfirm(false));}
  },[disabled,draft]);
  useEffect(()=>{if(confirm)dialog.current?.showModal();},[confirm]);
  function start() {
    if(disabled || recognition.current)return;
    const Constructor=(window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if(!Constructor){onStatus('Dictation is unavailable in this browser. Use your keyboard microphone or type a message.');return;}
    const active=new Constructor();
    active.lang=navigator.language || 'en-US';
    active.continuous=false;
    active.interimResults=false;
    recognition.current=active;
    setListening(true);
    onStatus('Listening... Tap the microphone to stop.');
    active.onresult=event=>{
      if(recognition.current!==active)return;
      const text=Array.from(event.results).filter(result=>result.isFinal).map(result=>result[0].transcript).join(' ').trim();
      recognition.current=null;
      active.onresult=null;active.onerror=null;active.onend=null;
      active.abort();setListening(false);
      if(text){transcriptRef.current(text);statusRef.current('Dictation added to your draft.');}
      else statusRef.current('No speech recognized. Try again.');
    };
    active.onerror=event=>{
      if(recognition.current!==active)return;
      statusRef.current(event.error==='not-allowed' || event.error==='service-not-allowed'
        ? 'Microphone access was denied. Allow it in browser settings or keep typing.'
        : event.error==='no-speech' ? 'No speech recognized. Try again.' : 'Dictation could not finish. Check your microphone and connection, then try again.');
      recognition.current=null;active.abort();setListening(false);
    };
    active.onend=()=>{if(recognition.current===active){recognition.current=null;setListening(false);statusRef.current('Dictation stopped.');}};
    try {active.start();} catch {recognition.current=null;setListening(false);onStatus('Dictation could not start. Check microphone permissions and try again.');}
  }
  function toggle() {
    if(recognition.current){recognition.current.stop();return;}
    if(consented)start();else setConfirm(true);
  }
  return <>
    <button type="button" className={`composer-action composer-mic${listening?' listening':''}`} disabled={disabled} aria-label={listening?'Stop dictation':'Dictate message'} aria-pressed={listening} title={listening?'Stop dictation':'Dictate message'} onClick={toggle}>{listening?<Square size={17}/>:<Mic size={20}/>}</button>
    {confirm && <dialog ref={dialog} className="chat-delete-dialog" aria-labelledby="dictation-title" onCancel={()=>setConfirm(false)}>
      <h2 id="dictation-title">Dictate a message</h2><p>Your browser may send audio to its speech recognition service. The transcript is added to your draft, ready for review before sending.</p>
      <div className="sheet-actions"><button className="btn btn-ghost" autoFocus onClick={()=>setConfirm(false)}>Cancel</button><button className="btn btn-primary" onClick={()=>{setConfirm(false);setConsented(true);start();}}>Start dictation</button></div>
    </dialog>}
  </>;
}
