'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AudioLines, ArrowUpRight, Check, ChevronDown, FileText, Headphones, LoaderCircle, Pause, Play, Plus, RotateCcw, SkipBack, SkipForward, Upload, WandSparkles, X } from 'lucide-react';
import { MAX_CHARACTERS, MAX_EPISODES, SAMPLE_TEXT, SAMPLE_TITLE, SERIES_SAMPLE, cleanText, estimatedSeconds, formatTime, splitPassages, suggestedTitle, wordCount, splitEpisodes, mergeDraftWithPrevious, type EpisodeDraft, type SplitMethod } from '../lib/podcast';
import { Narrator, type PlaybackSnapshot } from '../lib/narrator';
import { extractFile } from '../lib/extract-file';
import { NeuralNarrator } from '../lib/neural-narrator';
import { NeuralSpeechClient } from '../lib/neural-client';
import { DEFAULT_NEURAL_VOICE, NEURAL_VOICES, type SpeechEngine, type VoiceProgress } from '../lib/neural-voices';

type Episode = { id: string; title: string; text: string; passages: string[]; words: number; voice: string; voiceName: string; rate: number; engine: SpeechEngine };
type ModelContext = { registerTool: (tool: {name: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => unknown}, options: {signal: AbortSignal}) => void | Promise<void> };

export default function Home() {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState<'text' | 'file'>('text');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState('');
  const [engine, setEngine] = useState<SpeechEngine>('neural');
  const [neuralVoice, setNeuralVoice] = useState<string>(DEFAULT_NEURAL_VOICE);
  const [aiSupported, setAiSupported] = useState<boolean | null>(null);
  const [voiceProgress, setVoiceProgress] = useState<VoiceProgress>({status: 'idle', message: ''});
  const [rate, setRate] = useState(1);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [outputMode, setOutputMode] = useState<'single' | 'series'>('single');
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('episodes');
  const [separator, setSeparator] = useState('---EPISODE---');
  const [drafts, setDrafts] = useState<EpisodeDraft[]>([]);
  const [reviewSignature, setReviewSignature] = useState<{text: string; method: SplitMethod; separator: string} | null>(null);
  const [splitMessage, setSplitMessage] = useState('');
  const [queueSource, setQueueSource] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [workProgress, setWorkProgress] = useState('');
  const [transcriptPage, setTranscriptPage] = useState(0);
  const [playback, setPlayback] = useState<PlaybackSnapshot>({status: 'idle', index: 0, error: ''});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const narrator = useRef<Narrator | NeuralNarrator | null>(null);
  const deviceNarrator = useRef<Narrator | null>(null);
  const neuralNarrator = useRef<NeuralNarrator | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const output = useRef<HTMLHeadingElement>(null);
  const importToken = useRef(0);
  const importController = useRef<AbortController | null>(null);
  const preparationToken = useRef(0);
  const activeEpisodeId = useRef('');
  const positions = useRef(new Map<string, PlaybackSnapshot>());
  const stage = useRef((value: string, name?: string) => {});
  const words = useMemo(() => wordCount(text), [text]);
  const draftWords = useMemo(() => drafts.map(draft=>wordCount(draft.text)), [drafts]);
  const playing = playback.status === 'playing' || playback.status === 'starting';
  const duration = episode ? Math.max(1, episode.words / (165 * episode.rate) * 60) : 0;
  const completed = playback.status === 'ended';
  const progress = episode ? (completed ? 1 : playback.index / episode.passages.length) : 0;
  const sourceChanged = episodes.length > 0 && text !== queueSource;
  const busy = importing || preparing;
  const reviewCurrent = reviewSignature?.text === text && reviewSignature.method === splitMethod && reviewSignature.separator === separator;
  const transcriptPages = episode ? Math.ceil(episode.passages.length / 40) : 0;
  const currentVoice = voices.find(v => v.voiceURI === voice);
  const canCreate = engine === 'neural' ? aiSupported : supported;

  stage.current = (value, name) => { importToken.current++; importController.current?.abort(); importController.current = null; preparationToken.current++; setImporting(false); setPreparing(false); setWorkProgress(''); setFiles([]); setDrafts([]); setReviewSignature(null); if (fileInput.current) fileInput.current.value = ''; setText(value); if (name !== undefined) setTitle(name); setTab('text'); setError(''); setNotice(''); };

  useEffect(() => {
    const available = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    setSupported(available);
    const aiAvailable = 'Worker' in window && 'AudioContext' in window && typeof WebAssembly !== 'undefined';
    setAiSupported(aiAvailable);
    const update = (state: PlaybackSnapshot) => { if (activeEpisodeId.current) positions.current.set(activeEpisodeId.current, state); setPlayback(state); };
    if (aiAvailable) {
      const speech = new NeuralSpeechClient(setVoiceProgress, () => new Worker(new URL('../lib/neural.worker.ts', import.meta.url), {type: 'module'}));
      neuralNarrator.current = new NeuralNarrator(speech, () => new AudioContext(), update);
    }
    const synth = window.speechSynthesis;
    const loadVoices = () => setVoices(synth?.getVoices().slice().sort((a,b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)) ?? []);
    if (available) { deviceNarrator.current = new Narrator(synth, value => new SpeechSynthesisUtterance(value), update); loadVoices(); synth.addEventListener('voiceschanged', loadVoices); }
    const stopOnLeave = () => narrator.current?.pause();
    window.addEventListener('pagehide', stopOnLeave);
    return () => { importToken.current++; importController.current?.abort(); preparationToken.current++; deviceNarrator.current?.dispose(); neuralNarrator.current?.dispose(); deviceNarrator.current = null; neuralNarrator.current = null; narrator.current = null; synth?.removeEventListener('voiceschanged', loadVoices); window.removeEventListener('pagehide', stopOnLeave); };
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
          if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > MAX_CHARACTERS || (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 80))) throw new Error('Supply 1–1,000,000 characters of text and an optional title up to 80 characters.');
          if (Object.keys(value).some(key => !['text', 'title'].includes(key))) throw new Error('Unknown input field.');
          flushSync(() => stage.current(value.text as string, value.title as string | undefined));
          return {status: 'source_ready_for_review', characters: value.text.length};
        },
      }, {signal: lifecycle.signal})).catch(() => {});
    } catch { /* Optional browser integration; normal UI remains available. */ }
    return () => lifecycle.abort();
  }, []);

  async function importFiles(selected: File[]) {
    if (!selected.length || busy || importController.current) return;
    if (selected.length > 10) { setError('Add up to 10 files at a time.'); return; }
    const token = ++importToken.current;
    const controller = new AbortController(); importController.current = controller;
    setImporting(true); setError(''); setNotice('');
    const extracted: string[] = [];
    const names: string[] = [];
    const failures: string[] = [];
    let total = text.length;
    for (const file of selected) {
      if (token !== importToken.current) return;
      try {
        const contents = await extractFile(file, {signal:controller.signal, onProgress:message=>{if(token===importToken.current)setWorkProgress(message);}});
        if (token !== importToken.current) return;
        const addedLength = contents.length + (total ? 2 : 0);
        if (total + addedLength > MAX_CHARACTERS) throw new Error('Adding this file would exceed 1,000,000 characters. Use a smaller section.');
        extracted.push(contents); names.push(file.name); total += addedLength;
      } catch (e) { failures.push(`${file.name}: ${e instanceof Error ? e.message : 'Could not read this file.'}`); }
    }
    if (token !== importToken.current) return;
    if (extracted.length) {
      setText(previous => [previous.trim(), ...extracted].filter(Boolean).join('\n\n'));
      setFiles(previous => [...previous, ...names]);
      if (!text.trim()) setTitle(previous => previous || names[0].replace(/\.[^.]+$/, '').slice(0, 80));
      setDrafts([]); setReviewSignature(null);
      setTab('text'); setNotice(`${names.length} ${names.length === 1 ? 'file added' : 'files added'}. Choose Multiple episodes below to split the document.`);
    }
    setError(failures.join('\n')); setImporting(false); setWorkProgress(''); importController.current = null;
    if (fileInput.current) fileInput.current.value = '';
  }

  function cancelWork() { importToken.current++; importController.current?.abort(); importController.current = null; preparationToken.current++; setImporting(false); setPreparing(false); setWorkProgress(''); setNotice('Cancelled. Your source and current episodes are unchanged.'); if(fileInput.current) fileInput.current.value=''; }

  function reviewEpisodes() {
    if (busy) return;
    setError(''); setNotice('');
    try { const result = splitEpisodes(text,splitMethod,separator); setDrafts(result.drafts); setSplitMessage(result.message); setReviewSignature({text,method:splitMethod,separator}); }
    catch(e) { setError(e instanceof Error?e.message:'Could not split this document.'); setDrafts([]); setReviewSignature(null); }
  }

  function activateEpisode(next: Episode, autoplay = false) {
    const saved = positions.current.get(next.id);
    narrator.current?.pause();
    activeEpisodeId.current = next.id;
    narrator.current = next.engine === 'neural' ? neuralNarrator.current : deviceNarrator.current;
    narrator.current?.prepare(next.passages,next.voice,next.rate);
    if (saved && saved.status !== 'ended' && saved.index > 0) narrator.current?.seek(saved.index);
    setTranscriptPage(saved && saved.status!=='ended'?Math.floor(saved.index/40):0);
    setEpisode(next);
    if (autoplay) narrator.current?.play();
  }

  async function createEpisode() {
    if (!canCreate || busy) return;
    if (outputMode === 'series' && (!reviewCurrent || !drafts.length)) { setError('Review the current episode split before creating episodes.'); return; }
    const sourceDrafts = outputMode === 'series' ? drafts : [{id:'single',title:title.trim() || suggestedTitle(text),text}];
    const token = ++preparationToken.current;
    setPreparing(true); setError(''); setNotice('');
    const created: Episode[] = [];
    try {
      for (const [index,draft] of sourceDrafts.entries()) {
        setWorkProgress(`Preparing episode ${index+1} of ${sourceDrafts.length}…`);
        await new Promise(resolve=>setTimeout(resolve,0));
        if (token!==preparationToken.current) return;
        const cleaned = cleanText(draft.text); const passages = splitPassages(draft.text);
        if (!passages.length) throw new Error(`Episode ${index+1} has no readable text. Edit the source or merge that split, then try again.`);
        const aiVoice = NEURAL_VOICES.find(item => item.id === neuralVoice)!;
        created.push({id:`${token}-${draft.id}`,title:draft.title.trim() || `Episode ${index+1}`,text:cleaned,words:wordCount(cleaned),passages,voice:engine==='neural'?neuralVoice:voice,voiceName:engine==='neural'?`${aiVoice.name} · ${aiVoice.accent} AI voice`:currentVoice?.name || 'Device default',rate,engine});
      }
      if(token!==preparationToken.current)return;
      positions.current.clear(); setEpisodes(created); setQueueSource(text); activateEpisode(created[0]);
      setNotice(`${created.length===1?'Your episode is':`${created.length} episodes are`} ready. Choose an episode and press play.`);
      requestAnimationFrame(() => { output.current?.focus({preventScroll: true}); if (window.innerWidth < 701) output.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'}); });
    } catch(e) { if(token===preparationToken.current)setError(e instanceof Error?e.message:'Could not prepare the episodes.'); }
    finally { if(token===preparationToken.current){setPreparing(false);setWorkProgress('');} }
  }

  function sample() { stage.current(SAMPLE_TEXT, SAMPLE_TITLE); setFiles([]); }
  function updatePlaybackRate(value: number) { setEpisode(prev => prev ? {...prev, rate: value} : prev); setEpisodes(previous=>previous.map(item=>item.id===episode?.id?{...item,rate:value}:item)); narrator.current?.setRate(value); }

  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="/" aria-label="Podroom home"><span className="brand-icon"><AudioLines size={22}/></span>podroom<span className="brand-period">.</span></a><div className="header-center">YOUR PERSONAL AUDIO STUDIO</div><span className="header-label"><Headphones size={16}/> Made for listening</span></header>
    <main><div className="page-heading"><div><div className="eyebrow">THE STUDIO</div><h1>Create a podcast<span>.</span></h1><p>Give your words a voice. Paste a thought, an article, or a whole document.</p></div><span className="edition">TEXT IN. AUDIO OUT.</span></div>
      <div className="studio-grid">
        <section className="source-card" aria-labelledby="source-heading">
          <div className="section-heading"><div className="number">01</div><h2 id="source-heading">Add your source</h2><span className="small-label">START HERE</span></div>
          <div className="tabs" aria-label="Source input method"><button className={tab==='text'?'active':''} aria-pressed={tab==='text'} onClick={()=>setTab('text')}><FileText size={17}/>Paste text</button><button className={tab==='file'?'active':''} aria-pressed={tab==='file'} onClick={()=>setTab('file')}><Upload size={17}/>Upload files</button></div>
          <input ref={fileInput} type="file" multiple accept=".txt,.md,.markdown,.pdf,.docx" className="visually-hidden" tabIndex={-1} aria-label="Upload source documents" onChange={e=>void importFiles(Array.from(e.target.files ?? []))}/>
          {tab==='text' ? <div className="text-area"><textarea aria-label="Source text" aria-describedby="source-count" value={text} maxLength={MAX_CHARACTERS} disabled={busy} onChange={e=>{setText(e.target.value);setNotice('');}} placeholder={'Every good episode starts with an idea.\n\nPaste your article, notes, story, or anything you’d like to listen to…'}/><div className="text-footer"><span id="source-count">{words.toLocaleString()} words{words>0 && ` · ~${formatTime(words / (165 * rate) * 60)}`}</span><div className="text-actions">{text ? <button disabled={busy} onClick={()=>stage.current('')}><X size={13}/>Clear</button> : <button disabled={busy} onClick={sample}><Plus size={14}/>Try an example</button>}</div></div></div>
          : <div className={`drop-zone ${dragging ? 'is-dragging' : ''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);void importFiles(Array.from(e.dataTransfer.files));}}>
            <span className="upload-symbol">{importing?<LoaderCircle size={26} className="spin"/>:<Upload size={26}/>}</span><h3>{importing?'Reading your documents…':'Drop your documents here'}</h3><p>TXT, Markdown, PDF, or DOCX<br/>Up to 50 MB per file · 1,000,000 characters total</p><button className="browse-button" disabled={busy} onClick={()=>fileInput.current?.click()}>{importing?'Reading files…':'Choose files'}<Plus size={15}/></button><p className="import-note">Text is added to your source for review.<br/>Scanned documents need text recognition first.</p>
          </div>}
          {files.length>0 && <div className="file-chips" aria-label="Imported documents">{files.map((file,i)=><span key={`${file}-${i}`}><FileText size={12}/>{file}</span>)}</div>}
          {text.length>900000 && <p className="limit-note">{text.length.toLocaleString()} / 1,000,000 characters</p>}
          {busy && <div className="work-status" role="status"><LoaderCircle size={16} className="spin"/><span>{workProgress || 'Preparing…'}</span><button onClick={cancelWork}>Cancel</button></div>}
          <div aria-live="polite" aria-atomic="true">{notice && <p className="notice"><Check size={15}/>{notice}</p>}</div>
          {error && <p role="alert" className="error-message">{error}</p>}
          <div className="settings"><div className="section-heading"><div className="number">02</div><h2>Make it yours</h2></div>
            <div className="tabs mode-tabs" aria-label="Episode layout"><button disabled={busy} aria-pressed={outputMode==='single'} className={outputMode==='single'?'active':''} onClick={()=>setOutputMode('single')}>One episode</button><button disabled={busy} aria-pressed={outputMode==='series'} className={outputMode==='series'?'active':''} onClick={()=>setOutputMode('series')}>Multiple episodes</button></div>
            {outputMode==='single' ? <><label htmlFor="episode-title">Episode title <span>OPTIONAL</span></label><input id="episode-title" value={title} disabled={busy} maxLength={80} onChange={e=>setTitle(e.target.value)} placeholder="Give this episode a name"/></> : <div className="split-panel">
              <label>Split the document at<select value={splitMethod} disabled={busy} onChange={e=>setSplitMethod(e.target.value as SplitMethod)}><option value="episodes">Episode or chapter headings</option><option value="headings">Markdown headings</option><option value="separator">A separator line</option></select></label>
              {splitMethod==='separator' ? <label className="separator-label">Separator text<input value={separator} disabled={busy} maxLength={120} onChange={e=>setSeparator(e.target.value)} placeholder="---EPISODE---"/><span className="field-help">Put this exact text on its own line between episodes.</span></label> : <p className="split-help">{splitMethod==='episodes'?'Detects headings such as “Episode 1: Getting started”, “Ep. 2”, and “Chapter 3”.':'Uses the highest repeated Markdown heading level, such as # Episode title or ## Episode title.'}</p>}
              <div className="review-actions"><button className="review-button" disabled={!text.trim()||busy} onClick={reviewEpisodes}>Review episode split<ArrowUpRight size={16}/></button>{!text && <button className="text-link" onClick={()=>{stage.current(SERIES_SAMPLE,'Curiosity, in three episodes');setSplitMethod('episodes');}}>Try a series</button>}</div>
              {drafts.length>0 && <div className="split-review"><div className="review-heading"><strong>{drafts.length} {drafts.length===1?'episode':'episodes'}</strong><span>Up to {MAX_EPISODES} per document</span></div><p className="split-help">{reviewCurrent?splitMessage:'The source or split settings changed. Review again before creating episodes.'}</p>
                <div className={reviewCurrent?'draft-list':'draft-list stale'}>{drafts.map((draft,index)=><div className="draft-row" key={draft.id}><div className="draft-title"><span>{String(index+1).padStart(2,'0')}</span><input aria-label={"Title for episode "+(index+1)} value={draft.title} maxLength={120} disabled={busy||!reviewCurrent} onChange={e=>setDrafts(previous=>previous.map(item=>item.id===draft.id?{...item,title:e.target.value}:item))}/></div><div className="draft-meta"><span>{draftWords[index].toLocaleString()} words · ~{formatTime(draftWords[index]/(165*rate)*60)}</span>{index>0 && <button disabled={busy||!reviewCurrent} onClick={()=>setDrafts(previous=>mergeDraftWithPrevious(previous,index))}>Merge with previous</button>}</div>{draft.warning&&<p className="draft-warning">{draft.warning}</p>}<details className="draft-content"><summary>Review episode text</summary><pre>{draft.text}</pre></details></div>)}</div>
              </div>}
            </div>}
            <label className="engine-label">Voice engine<select disabled={busy} value={engine} onChange={e=>setEngine(e.target.value as SpeechEngine)}><option value="neural">AI voices · Free</option><option value="device">Device voices</option></select></label>
            <div className="settings-row"><label>Narrator{engine==='neural'?<select disabled={busy} value={neuralVoice} onChange={e=>setNeuralVoice(e.target.value)}>{NEURAL_VOICES.map(v=><option key={v.id} value={v.id}>{v.name} · {v.accent} · {v.description}</option>)}</select>:<select disabled={busy} value={voice} onChange={e=>setVoice(e.target.value)}><option value="">Device default</option>{voices.map(v=><option key={`${v.voiceURI}-${v.name}`} value={v.voiceURI}>{v.name} · {v.lang}{v.localService?' · Device':' · Online'}</option>)}</select>}</label><label>Pace<select disabled={busy} value={rate} onChange={e=>setRate(Number(e.target.value))}><option value={0.75}>0.75× · Relaxed</option><option value={1}>1× · Natural</option><option value={1.25}>1.25× · Brisk</option><option value={1.5}>1.5× · Quick</option><option value={2}>2× · Fast</option></select></label></div>
            <p className="voice-help">{engine==='neural'?'Natural English narration with Kokoro. No API key or usage fees. First play downloads about 120 MB; later visits can reuse the cached model.':'Voices available on this device, including other languages. Online voices may send text to their provider.'}</p>
            <button className="create-button" disabled={!text.trim() || !canCreate || busy || (outputMode==='series' && (!reviewCurrent || !drafts.length))} onClick={()=>void createEpisode()}><WandSparkles size={19}/>{preparing?'Preparing episodes…':outputMode==='series'?`Create ${reviewCurrent?drafts.length:''} episodes`:episode?'Create new podcast':'Create podcast'}<ArrowUpRight size={20}/></button>
            {canCreate===false ? <p className="error-message">{engine==='neural'?'AI voices need WebAssembly and browser audio. Try a recent browser, or choose Device voices above.':'Device speech is unavailable in this browser. Choose AI voices above or try another browser.'}</p> : <p className="settings-note">{engine==='neural'?'AI-generated speech. Your text stays in this browser.':'Your words, narrated in full with your browser’s voices.'}</p>}
            {sourceChanged && <p className="source-changed">Source changed. Create again to update your episodes.</p>}
          </div>
        </section>
        <section className="episode-column" aria-labelledby="listen-heading">
          <div className="section-heading output-heading"><div className="number">03</div><h2 id="listen-heading">Press play. Tune in.</h2>{episode&&<span className="ready-label"><Check size={12}/>READY TO LISTEN</span>}</div>
          <div className={`player-card ${playing?'is-playing':''}`}><div className="player-top"><span>{episode?'YOUR WORDS, ON AIR':'PODROOM ORIGINAL'}</span><AudioLines size={24}/></div><div className="cover-copy"><p>{episode?'A PERSONAL LISTEN':'FROM THE PAGE'}</p><h2>To your<br/>headphones<span>.</span></h2></div><div className="waveform" aria-hidden="true">{Array.from({length:57},(_,i)=><span key={i} style={{height:`${Math.round(14+Math.abs(Math.sin(i*.79)*Math.cos(i*.23))*75)}%`,animationDelay:`${-i*8/100}s`}}/>)}</div><div className="player-bottom"><span>{episode?`${episode.words.toLocaleString()} WORDS · FULL NARRATION`:'YOUR NEXT LISTEN'}</span><span>{episode?(episode.engine==='neural'?'AI AUDIO':'DEVICE AUDIO'):'VOL. 001'}</span></div></div>
          <div className="playback-panel">
            {episodes.length>1 && <div className="episode-library"><div className="library-heading"><h3>Your episodes</h3><span>{episodes.length} ready</span></div><p className="split-help">Choose an episode to listen. Progress stays here while this tab is open.</p><ol>{episodes.map((item,index)=><li key={item.id} className={episode?.id===item.id?'selected':''}><button aria-label={"Play episode "+(index+1)+": "+item.title} aria-current={episode?.id===item.id?'true':undefined} onClick={()=>{if(episode?.id===item.id){playing?narrator.current?.pause():narrator.current?.play();}else activateEpisode(item,true);}}><span className="library-number">{episode?.id===item.id&&playing?<Pause size={15}/>:<Play size={15}/>}</span><span className="library-text"><strong>{item.title}</strong><small>{item.words.toLocaleString()} words · ~{formatTime(item.words/(165*item.rate)*60)}</small></span><span className="library-index">{String(index+1).padStart(2,'0')}</span></button></li>)}</ol></div>}
          <div className="episode-meta"><div><h3 ref={output} tabIndex={-1}>{episode?.title || 'Your episode lives here'}</h3><p>{episode?`${episode.voiceName} · About ${formatTime(duration)}`:'Add your source and create your first listen.'}</p></div><span className="audio-badge"><Headphones size={18}/></span></div>
            {episode ? <input className="progress-slider" type="range" min={0} max={Math.max(0,episode.passages.length-1)} value={playback.index} onChange={e=>narrator.current?.seek(Number(e.target.value))} aria-label="Jump to a transcript passage" aria-valuetext={`Passage ${playback.index+1} of ${episode.passages.length}`} style={{'--progress':`${progress*100}%`} as React.CSSProperties}/> : <div className="empty-progress"/>}
            <div className="time-row"><span>{formatTime(progress*duration)}</span><span>{episode?`${formatTime(duration)} estimated`:'—:—'}</span></div>
            <div className="player-controls"><button className="icon-button" disabled={!episode||playback.index===0} aria-label="Previous passage" title="Previous passage" onClick={()=>narrator.current?.seek(playback.index-1)}><SkipBack size={20}/></button><button className="play-button" disabled={!episode} aria-label={playing?'Pause episode':completed?'Replay episode':'Play episode'} onClick={()=>playing?narrator.current?.pause():narrator.current?.play()}>{playback.status==='starting'?<LoaderCircle size={22} className="spin"/>:playing?<Pause size={22} fill="currentColor"/>:completed?<RotateCcw size={22}/>:<Play size={22} fill="currentColor"/>}</button><button className="icon-button" disabled={!episode||playback.index>=(episode?.passages.length??0)-1} aria-label="Next passage" title="Next passage" onClick={()=>narrator.current?.seek(playback.index+1)}><SkipForward size={20}/></button></div>
            {episode && <div className="playback-subrow"><span aria-live="polite">{completed?'Finished':playback.status==='starting'?(episode.engine==='neural'?'Preparing AI audio…':'Starting voice…'):playback.status==='playing'?'Playing':playback.status==='paused'?'Paused':'Ready to play'}</span><label>Speed<select aria-label="Playback speed" value={episode.rate} onChange={e=>updatePlaybackRate(Number(e.target.value))}>{[.75,1,1.25,1.5,2].map(v=><option key={v} value={v}>{v}×</option>)}</select></label></div>}
            {episode?.engine==='neural' && voiceProgress.status==='loading' && <div className="voice-loading" role="status"><LoaderCircle size={16} className="spin"/><span>{voiceProgress.message}</span><button onClick={()=>neuralNarrator.current?.cancelLoading()}>Cancel</button></div>}
            {playback.error && <p className="error-message" role="alert">{playback.error}</p>}
          </div>
          {episode ? <details className="transcript" open><summary><span><FileText size={17}/>Episode transcript</span><ChevronDown size={17}/></summary><p className="transcript-help">Choose a passage to jump there, then press play.</p><div className="transcript-scroll">{episode.passages.slice(transcriptPage*40,(transcriptPage+1)*40).map((passage,localIndex)=>{const i=transcriptPage*40+localIndex;return <button key={i} className={`transcript-passage ${i===playback.index?'current':''}`} aria-label={`Jump to passage ${i+1}: ${passage}`} aria-current={i===playback.index?'true':undefined} onClick={()=>narrator.current?.seek(i)}><span className="passage-number">{String(i+1).padStart(2,'0')}</span><span>{passage}</span></button>;})}</div>{transcriptPages>1 && <div className="transcript-pagination"><button disabled={transcriptPage===0} onClick={()=>setTranscriptPage(page=>page-1)}>Previous</button><span>{transcriptPage+1} / {transcriptPages}</span><button disabled={transcriptPage>=transcriptPages-1} onClick={()=>setTranscriptPage(page=>page+1)}>Next</button><button onClick={()=>setTranscriptPage(Math.floor(playback.index/40))}>Current passage</button></div>}</details> : <div className="listen-note"><span><FileText size={20}/></span><div><h3>A little less screen. A little more listening.</h3><p>Turn your reading into listening time. Your transcript will appear here once your episode is ready.</p></div></div>}
          <details className="about-audio"><summary>About the voices<ChevronDown size={13}/></summary><p>AI voices use Kokoro to generate English speech in this browser. The model and voice files download from Hugging Face; your text is processed on your device. The first download is about 120 MB. Generation speed depends on your device, and longer documents may pause briefly between passages.</p><p>Keep this tab open while listening. Audio is generated a passage at a time, with a small temporary cache. Episodes and audio are not saved after a refresh. This app narrates your text; it does not rewrite it as a conversation or offer an MP3 download.</p><p>Device voices are also available. Voices marked “Online” may send text to their provider. AI audio pauses at the current position; device voices resume from the latest reported word boundary or the start of the passage.</p></details>
        </section>
      </div><footer><span><AudioLines size={16}/> A new way to hear your words.</span><span>BUILT FOR YOUR EARS</span></footer>
    </main></div>;
}
