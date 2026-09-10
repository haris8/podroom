'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AudioLines, ArrowUpRight, Check, ChevronDown, FileText, Headphones, LoaderCircle, Pause, Play, Plus, RotateCcw, SkipBack, SkipForward, Upload, WandSparkles, X } from 'lucide-react';
import { MAX_CHARACTERS, SAMPLE_TEXT, SAMPLE_TITLE, cleanText, estimatedSeconds, formatTime, splitPassages, suggestedTitle, wordCount } from '../lib/podcast';
import { Narrator, type PlaybackSnapshot } from '../lib/narrator';
import { extractFile } from '../lib/extract-file';

type Episode = { title: string; text: string; passages: string[]; voice: string; voiceName: string; rate: number };
type ModelContext = { registerTool: (tool: {name: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => unknown}, options: {signal: AbortSignal}) => void | Promise<void> };

export default function Home() {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState<'text' | 'file'>('text');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState('');
  const [rate, setRate] = useState(1);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [playback, setPlayback] = useState<PlaybackSnapshot>({status: 'idle', index: 0, error: ''});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const narrator = useRef<Narrator | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const output = useRef<HTMLHeadingElement>(null);
  const importToken = useRef(0);
  const stage = useRef((value: string, name?: string) => {});
  const words = wordCount(text);
  const playing = playback.status === 'playing' || playback.status === 'starting';
  const duration = episode ? estimatedSeconds(episode.text, episode.rate) : 0;
  const completed = playback.status === 'ended';
  const progress = episode ? (completed ? 1 : playback.index / episode.passages.length) : 0;
  const sourceChanged = episode && cleanText(text) !== episode.text;
  const currentVoice = voices.find(v => v.voiceURI === voice);

  stage.current = (value, name) => { importToken.current++; setImporting(false); setFiles([]); if (fileInput.current) fileInput.current.value = ''; setText(value); if (name !== undefined) setTitle(name); setTab('text'); setError(''); setNotice(''); };

  useEffect(() => {
    const available = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    setSupported(available);
    if (!available) return;
    const synth = window.speechSynthesis;
    narrator.current = new Narrator(synth, value => new SpeechSynthesisUtterance(value), setPlayback);
    const loadVoices = () => setVoices(synth.getVoices().slice().sort((a,b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)));
    loadVoices(); synth.addEventListener('voiceschanged', loadVoices);
    const stopOnLeave = () => narrator.current?.pause();
    window.addEventListener('pagehide', stopOnLeave);
    return () => { importToken.current++; narrator.current?.dispose(); narrator.current = null; synth.removeEventListener('voiceschanged', loadVoices); window.removeEventListener('pagehide', stopOnLeave); };
  }, []);

  useEffect(() => {
    const context = (document as Document & {modelContext?: ModelContext}).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: 'set_source_text',
        description: 'Replace the visible podcast source editor with supplied text and an optional episode title. Does not create or play an episode; the user can review and edit the text.',
        inputSchema: {type: 'object', properties: {text: {type: 'string', minLength: 1, maxLength: MAX_CHARACTERS}, title: {type: 'string', maxLength: 80}}, required: ['text'], additionalProperties: false},
        annotations: {readOnlyHint: false, untrustedContentHint: true},
        execute(input) {
          if (!input || typeof input !== 'object') throw new Error('Supply a text object.');
          const value = input as {text?: unknown; title?: unknown};
          if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > MAX_CHARACTERS || (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 80))) throw new Error('Supply 1–100,000 characters of text and an optional title up to 80 characters.');
          if (Object.keys(value).some(key => !['text', 'title'].includes(key))) throw new Error('Unknown input field.');
          flushSync(() => stage.current(value.text as string, value.title as string | undefined));
          return {status: 'source_ready_for_review', characters: value.text.length};
        },
      }, {signal: lifecycle.signal})).catch(() => {});
    } catch { /* Optional browser integration; normal UI remains available. */ }
    return () => lifecycle.abort();
  }, []);

  async function importFiles(selected: File[]) {
    if (!selected.length || importing) return;
    if (selected.length > 10) { setError('Add up to 10 files at a time.'); return; }
    const token = ++importToken.current;
    setImporting(true); setError(''); setNotice('');
    const extracted: string[] = [];
    const names: string[] = [];
    const failures: string[] = [];
    let total = text.length;
    for (const file of selected) {
      if (token !== importToken.current) return;
      try {
        const contents = await extractFile(file);
        if (token !== importToken.current) return;
        if (total + contents.length + 2 > MAX_CHARACTERS) throw new Error('Adding this file would exceed 100,000 characters. Use a smaller section.');
        extracted.push(contents); names.push(file.name); total += contents.length + 2;
      } catch (e) { failures.push(`${file.name}: ${e instanceof Error ? e.message : 'Could not read this file.'}`); }
    }
    if (token !== importToken.current) return;
    if (extracted.length) {
      setText(previous => [previous.trim(), ...extracted].filter(Boolean).join('\n\n'));
      setFiles(previous => [...previous, ...names]);
      if (!text.trim()) setTitle(previous => previous || names[0].replace(/\.[^.]+$/, '').slice(0, 80));
      setTab('text'); setNotice(`${names.length} ${names.length === 1 ? 'file added' : 'files added'}. Review the text before creating your episode.`);
    }
    setError(failures.join('\n')); setImporting(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function createEpisode() {
    if (!supported || importing) return;
    setError(''); setNotice('');
    const cleaned = cleanText(text);
    const passages = splitPassages(text);
    if (!passages.length) { setError('Add some readable text to create an episode.'); return; }
    const next = {title: title.trim() || suggestedTitle(text), text: cleaned, passages, voice, voiceName: currentVoice?.name || 'Device default', rate};
    narrator.current?.prepare(passages, voice, rate);
    setEpisode(next); setNotice('Your episode is ready. Press play to start listening.');
    requestAnimationFrame(() => { output.current?.focus({preventScroll: true}); if (window.innerWidth < 701) output.current?.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center'}); });
  }

  function sample() { stage.current(SAMPLE_TEXT, SAMPLE_TITLE); setFiles([]); }
  function updatePlaybackRate(value: number) { setEpisode(prev => prev ? {...prev, rate: value} : prev); narrator.current?.setRate(value); }

  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="/" aria-label="Podroom home"><span className="brand-icon"><AudioLines size={22}/></span>podroom<span className="brand-period">.</span></a><div className="header-center">YOUR PERSONAL AUDIO STUDIO</div><span className="header-label"><Headphones size={16}/> Made for listening</span></header>
    <main><div className="page-heading"><div><div className="eyebrow">THE STUDIO</div><h1>Create a podcast<span>.</span></h1><p>Give your words a voice. Paste a thought, an article, or a whole document.</p></div><span className="edition">TEXT IN. AUDIO OUT.</span></div>
      <div className="studio-grid">
        <section className="source-card" aria-labelledby="source-heading">
          <div className="section-heading"><div className="number">01</div><h2 id="source-heading">Add your source</h2><span className="small-label">START HERE</span></div>
          <div className="tabs" aria-label="Source input method"><button className={tab==='text'?'active':''} aria-pressed={tab==='text'} onClick={()=>setTab('text')}><FileText size={17}/>Paste text</button><button className={tab==='file'?'active':''} aria-pressed={tab==='file'} onClick={()=>setTab('file')}><Upload size={17}/>Upload files</button></div>
          <input ref={fileInput} type="file" multiple accept=".txt,.md,.markdown,.pdf,.docx" className="visually-hidden" tabIndex={-1} aria-label="Upload source documents" onChange={e=>void importFiles(Array.from(e.target.files ?? []))}/>
          {tab==='text' ? <div className="text-area"><textarea aria-label="Source text" aria-describedby="source-count" value={text} maxLength={MAX_CHARACTERS} disabled={importing} onChange={e=>{setText(e.target.value);setNotice('');}} placeholder={'Every good episode starts with an idea.\n\nPaste your article, notes, story, or anything you’d like to listen to…'}/><div className="text-footer"><span id="source-count">{words.toLocaleString()} words{words>0 && ` · ~${formatTime(estimatedSeconds(text,rate))}`}</span><div className="text-actions">{text ? <button disabled={importing} onClick={()=>{setText('');setFiles([]);setNotice('');setError('');}}><X size={13}/>Clear</button> : <button disabled={importing} onClick={sample}><Plus size={14}/>Try an example</button>}</div></div></div>
          : <div className={`drop-zone ${dragging ? 'is-dragging' : ''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);void importFiles(Array.from(e.dataTransfer.files));}}>
            <span className="upload-symbol">{importing?<LoaderCircle size={26} className="spin"/>:<Upload size={26}/>}</span><h3>{importing?'Reading your documents…':'Drop your documents here'}</h3><p>TXT, Markdown, PDF, or DOCX<br/>Up to 10 MB per file · 100,000 characters total</p><button className="browse-button" disabled={importing} onClick={()=>fileInput.current?.click()}>{importing?'Reading files…':'Choose files'}<Plus size={15}/></button><p className="import-note">Text is added to your source for review.<br/>Scanned documents need text recognition first.</p>
          </div>}
          {files.length>0 && <div className="file-chips" aria-label="Imported documents">{files.map((file,i)=><span key={`${file}-${i}`}><FileText size={12}/>{file}</span>)}</div>}
          {text.length>90000 && <p className="limit-note">{text.length.toLocaleString()} / 100,000 characters</p>}
          <div aria-live="polite" aria-atomic="true">{notice && <p className="notice"><Check size={15}/>{notice}</p>}</div>
          {error && <p role="alert" className="error-message">{error}</p>}
          <div className="settings"><div className="section-heading"><div className="number">02</div><h2>Make it yours</h2></div><label htmlFor="episode-title">Episode title <span>OPTIONAL</span></label><input id="episode-title" value={title} maxLength={80} onChange={e=>setTitle(e.target.value)} placeholder="Give this episode a name"/>
            <div className="settings-row"><label>Narrator<select value={voice} onChange={e=>setVoice(e.target.value)}><option value="">Device default</option>{voices.map(v=><option key={`${v.voiceURI}-${v.name}`} value={v.voiceURI}>{v.name} · {v.lang}{v.localService?' · Device':' · Online'}</option>)}</select></label><label>Pace<select value={rate} onChange={e=>setRate(Number(e.target.value))}><option value={0.75}>0.75× · Relaxed</option><option value={1}>1× · Natural</option><option value={1.25}>1.25× · Brisk</option><option value={1.5}>1.5× · Quick</option><option value={2}>2× · Fast</option></select></label></div>
            <button className="create-button" disabled={!text.trim() || !supported || importing} onClick={createEpisode}><WandSparkles size={19}/>{episode?'Create new podcast':'Create podcast'}<ArrowUpRight size={20}/></button>
            {supported===false ? <p className="error-message">Speech playback is unavailable in this browser. Open this app in Chrome, Edge, or Safari with speech voices enabled.</p> : <p className="settings-note">Your words, narrated in full with your browser’s voices.</p>}
            {sourceChanged && <p className="source-changed">Source changed. Create again to update your episode.</p>}
          </div>
        </section>
        <section className="episode-column" aria-labelledby="listen-heading">
          <div className="section-heading output-heading"><div className="number">03</div><h2 id="listen-heading">Press play. Tune in.</h2>{episode&&<span className="ready-label"><Check size={12}/>READY TO LISTEN</span>}</div>
          <div className={`player-card ${playing?'is-playing':''}`}><div className="player-top"><span>{episode?'YOUR WORDS, ON AIR':'PODROOM ORIGINAL'}</span><AudioLines size={24}/></div><div className="cover-copy"><p>{episode?'A PERSONAL LISTEN':'FROM THE PAGE'}</p><h2>To your<br/>headphones<span>.</span></h2></div><div className="waveform" aria-hidden="true">{Array.from({length:57},(_,i)=><span key={i} style={{height:`${14+Math.abs(Math.sin(i*.79)*Math.cos(i*.23))*75}%`,animationDelay:`${i*-.08}s`}}/>)}</div><div className="player-bottom"><span>{episode?`${wordCount(episode.text).toLocaleString()} WORDS · FULL NARRATION`:'YOUR NEXT LISTEN'}</span><span>{episode?'BROWSER AUDIO':'VOL. 001'}</span></div></div>
          <div className="playback-panel"><div className="episode-meta"><div><h3 ref={output} tabIndex={-1}>{episode?.title || 'Your episode lives here'}</h3><p>{episode?`${episode.voiceName} · About ${formatTime(duration)}`:'Add your source and create your first listen.'}</p></div><span className="audio-badge"><Headphones size={18}/></span></div>
            {episode ? <input className="progress-slider" type="range" min={0} max={Math.max(0,episode.passages.length-1)} value={playback.index} onChange={e=>narrator.current?.seek(Number(e.target.value))} aria-label="Jump to a transcript passage" aria-valuetext={`Passage ${playback.index+1} of ${episode.passages.length}`} style={{'--progress':`${progress*100}%`} as React.CSSProperties}/> : <div className="empty-progress"/>}
            <div className="time-row"><span>{formatTime(progress*duration)}</span><span>{episode?`${formatTime(duration)} estimated`:'—:—'}</span></div>
            <div className="player-controls"><button className="icon-button" disabled={!episode||playback.index===0} aria-label="Previous passage" title="Previous passage" onClick={()=>narrator.current?.seek(playback.index-1)}><SkipBack size={20}/></button><button className="play-button" disabled={!episode||!supported} aria-label={playing?'Pause episode':completed?'Replay episode':'Play episode'} onClick={()=>playing?narrator.current?.pause():narrator.current?.play()}>{playback.status==='starting'?<LoaderCircle size={22} className="spin"/>:playing?<Pause size={22} fill="currentColor"/>:completed?<RotateCcw size={22}/>:<Play size={22} fill="currentColor"/>}</button><button className="icon-button" disabled={!episode||playback.index>=(episode?.passages.length??0)-1} aria-label="Next passage" title="Next passage" onClick={()=>narrator.current?.seek(playback.index+1)}><SkipForward size={20}/></button></div>
            {episode && <div className="playback-subrow"><span aria-live="polite">{completed?'Finished':playback.status==='starting'?'Starting voice…':playback.status==='playing'?'Playing':playback.status==='paused'?'Paused':'Ready to play'}</span><label>Speed<select aria-label="Playback speed" value={episode.rate} onChange={e=>updatePlaybackRate(Number(e.target.value))}>{[.75,1,1.25,1.5,2].map(v=><option key={v} value={v}>{v}×</option>)}</select></label></div>}
            {playback.error && <p className="error-message" role="alert">{playback.error}</p>}
          </div>
          {episode ? <details className="transcript" open><summary><span><FileText size={17}/>Episode transcript</span><ChevronDown size={17}/></summary><p className="transcript-help">Choose a passage to jump there, then press play.</p><div className="transcript-scroll">{episode.passages.map((passage,i)=><button key={i} className={`transcript-passage ${i===playback.index?'current':''}`} aria-label={`Jump to passage ${i+1}: ${passage}`} aria-current={i===playback.index?'true':undefined} onClick={()=>narrator.current?.seek(i)}><span className="passage-number">{String(i+1).padStart(2,'0')}</span><span>{passage}</span></button>)}</div></details> : <div className="listen-note"><span><FileText size={20}/></span><div><h3>A little less screen. A little more listening.</h3><p>Turn your reading into listening time. Your transcript will appear here once your episode is ready.</p></div></div>}
          <details className="about-audio"><summary>About browser audio<ChevronDown size={13}/></summary><p>Voices depend on your device. Voices marked “Online” may send text to the voice provider. Keep this tab open while listening.</p><p>Episodes play here and are not saved after a refresh. This version narrates your text; it does not create an MP3 or rewrite it as a conversation. Pausing resumes from the latest word boundary, or the start of the current passage when the voice does not report word positions.</p></details>
        </section>
      </div><footer><span><AudioLines size={16}/> A new way to hear your words.</span><span>BUILT FOR YOUR EARS</span></footer>
    </main></div>;
}
