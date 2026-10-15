import React, { useEffect, useState } from 'react';
import { supabase } from './supabase.js';

const PALETTE = ['#8b5cf6', '#0ea5a4', '#e879a9', '#e0a23b', '#5284d8'];

function fmt(value) {
  if (!Number.isFinite(value) || value < 0) return '00:00';
  const n = Math.floor(value);
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}

export default function App() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState('viewer');
  const [cards, setCards] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audio, setAudio] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [repeat, setRepeat] = useState({});
  const [progress, setProgress] = useState({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadCards(); }, [session]);

  async function login(e) {
    e.preventDefault();
    setStatus('Iniciando sesión…');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setStatus(error ? error.message : '');
  }

  async function loadCards() {
    setStatus('Cargando cartilla…');
    const { data: member, error: memberError } = await supabase.from('cartilla_members').select('role').eq('user_id', session.user.id).maybeSingle();
    if (memberError) { setStatus('Falta configurar el acceso de la cartilla en Supabase.'); return; }
    setRole(member?.role || 'viewer');
    const { data, error } = await supabase.from('cartilla_cards').select('*').order('position').order('created_at');
    if (error) { setStatus('No se pudieron cargar las secciones: ' + error.message); return; }
    const withAudio = await Promise.all((data || []).map(async card => {
      if (!card.audio_path) return { ...card, audio_url: null };
      const { data: signed, error: signedError } = await supabase.storage.from('cartilla-audio').createSignedUrl(card.audio_path, 3600);
      return { ...card, audio_url: signedError ? null : signed.signedUrl };
    }));
    setCards(withAudio);
    setStatus('');
    const { data: saved } = await supabase.from('cartilla_progress').select('card_id,seconds').eq('user_id', session.user.id);
    setProgress(Object.fromEntries((saved || []).map(p => [p.card_id, p.seconds || 0])));
  }

  async function addCard(e) {
    e.preventDefault();
    if (role !== 'admin') return;
    setSaving(true); setStatus('Guardando sección…');
    let audioPath = null;
    if (audio) {
      audioPath = crypto.randomUUID() + '-' + audio.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const { error } = await supabase.storage.from('cartilla-audio').upload(audioPath, audio, { contentType: audio.type || 'audio/mpeg', upsert: false });
      if (error) { setStatus('No se pudo subir el audio: ' + error.message); setSaving(false); return; }
    }
    const { error } = await supabase.from('cartilla_cards').insert({
      title: title.trim(), body: body.trim(), audio_path: audioPath, position: cards.length, created_by: session.user.id
    });
    if (error) setStatus('No se pudo guardar: ' + error.message);
    else { setTitle(''); setBody(''); setAudio(null); const input = document.getElementById('booklet-audio'); if (input) input.value = ''; await loadCards(); }
    setSaving(false);
  }

  async function removeCard(card) {
    if (role !== 'admin' || !window.confirm('¿Eliminar esta sección y su audio?')) return;
    if (card.audio_path) await supabase.storage.from('cartilla-audio').remove([card.audio_path]);
    const { error } = await supabase.from('cartilla_cards').delete().eq('id', card.id);
    setStatus(error ? error.message : 'Sección eliminada.');
    await loadCards();
  }

  async function savePosition(card, el) {
    if (!session || !el) return;
    const seconds = Math.floor(el.currentTime || 0);
    await supabase.from('cartilla_progress').upsert({
      user_id: session.user.id, card_id: card.id, seconds, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,card_id' });
    setProgress(prev => ({ ...prev, [card.id]: seconds }));
  }

  function restore(card, el) {
    if (!el || el.dataset.restoreStarted) return;
    el.dataset.restoreStarted = 'yes';
    const seconds = Number(progress[card.id] || 0);
    if (seconds > 0) {
      const apply = () => { if (seconds < el.duration) el.currentTime = seconds; };
      if (Number.isFinite(el.duration) && el.duration > 0) apply();
      else el.addEventListener('loadedmetadata', apply, { once: true });
    }
  }

  if (!supabase) return <main className="setup"><h1>Cartilla de consulta</h1><p>Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY para conectar esta cartilla a su propia base de datos.</p></main>;

  if (!session) return <main className="login-page"><form className="login-card" onSubmit={login}><div className="brand">CARTILLA<span> DIGITAL</span></div><p>Textos y audios en un solo lugar</p><label>Correo electrónico</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /><label>Contraseña</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} required /><button className="primary">Ingresar</button>{status && <small>{status}</small>}</form></main>;

  const shown = cards.filter(c => (c.title + ' ' + (c.body || '')).toLowerCase().includes(query.toLowerCase()));

  return <main className="page">
    <header className="topbar"><div className="brand">CARTILLA<span> DIGITAL</span></div><div className="account"><span>{role === 'admin' ? 'Administración' : 'Consulta'}</span><button className="quiet" onClick={() => supabase.auth.signOut()}>Salir</button></div></header>
    <section className="hero"><div className="eyebrow">GUÍA DE CONSULTA</div><h1>Textos y audios</h1><p>Cada sección muestra primero el texto y justo debajo su audio correspondiente.</p><label className="search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar un texto o paso…" /></label></section>
    {role === 'admin' && <form className="editor" onSubmit={addCard}><h2>Agregar una sección</h2><label>Título o número del paso</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej. Paso 1 · Saludo inicial" required /><label>Texto completo</label><textarea rows="5" value={body} onChange={e => setBody(e.target.value)} placeholder="Escribe aquí el texto que debe aparecer en la cartilla…" required /><label>Audio de este texto</label><input id="booklet-audio" type="file" accept="audio/*" onChange={e => setAudio(e.target.files?.[0] || null)} /><button className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar sección'}</button></form>}
    {status && <p className="status">{status}</p>}
    <section className="booklet">{shown.map((card, index) => <article className="section-card" key={card.id} style={{'--accent': PALETTE[index % PALETTE.length]}}>
      <div className="section-heading"><span className="number">{String(index + 1).padStart(2, '0')}</span><span className="section-label">SECCIÓN DE CONSULTA</span>{role === 'admin' && <button className="remove" onClick={() => removeCard(card)}>Eliminar</button>}</div>
      <h2>{card.title}</h2>
      <div className="text-panel"><div className="panel-label">TEXTO</div><p>{card.body || 'Esta sección no tiene texto todavía.'}</p></div>
      <div className="audio-panel"><div className="panel-label">AUDIO CORRESPONDIENTE</div>{card.audio_url ? <><audio key={card.audio_url} controls preload="metadata" loop={Boolean(repeat[card.id])} src={card.audio_url} ref={el => { if (el) el.dataset.cardId = card.id; }} onLoadedMetadata={e => restore(card, e.currentTarget)} onTimeUpdate={e => { const el = e.currentTarget; if (Math.floor(el.currentTime) % 5 === 0 && Math.floor(el.currentTime) !== Number(el.dataset.savedAt || -1)) { el.dataset.savedAt = String(Math.floor(el.currentTime)); savePosition(card, el); } }} onPause={e => savePosition(card, e.currentTarget)} onEnded={e => savePosition(card, e.currentTarget)} /><div className="audio-tools"><button type="button" onClick={() => { const a = document.querySelector('audio[data-card-id="' + card.id + '"]'); if (a) a.currentTime = Math.max(0, a.currentTime - 10); }}>↶ Retroceder 10 s</button><button type="button" onClick={() => { const a = document.querySelector('audio[data-card-id="' + card.id + '"]'); if (a) a.currentTime = Math.min(a.duration || Infinity, a.currentTime + 10); }}>Avanzar 10 s ↷</button><button type="button" className={repeat[card.id] ? 'repeat active' : 'repeat'} aria-pressed={Boolean(repeat[card.id])} onClick={() => setRepeat(prev => ({ ...prev, [card.id]: !prev[card.id] }))}>⟲ {repeat[card.id] ? 'Repetición activada' : 'Repetir audio'}</button></div><small>Usa la barra para ir a cualquier parte. Puedes pausar y continuar desde donde quedaste.</small></> : <p className="no-audio">El audio de esta sección aún no se ha cargado.</p>}</div>
    </article>)}</section>
    {!shown.length && !status && <div className="empty">Todavía no hay secciones. {role === 'admin' ? 'Agrega la primera desde el formulario.' : 'Pídele a la persona administradora que agregue contenido.'}</div>}
    <footer>Cartilla digital · Textos y audios organizados por sección</footer>
  </main>;
}
