import React, { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';

const COLORS = ['#f2c94c', '#eb5757', '#56ccf2', '#bb6bd9', '#6fcf97', '#f2994a'];

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [items, setItems] = useState([]);
  const [role, setRole] = useState('viewer');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [audio, setAudio] = useState(null);
  const [status, setStatus] = useState('');
  const audioRefs = useRef({});

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session && supabase) loadItems();
  }, [session]);

  async function signIn(e) {
    e.preventDefault(); setStatus('Iniciando sesión…');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setStatus(error ? error.message : '');
  }
  async function signOut() { await supabase.auth.signOut(); setItems([]); setRole('viewer'); }

  async function loadItems() {
    setStatus('Cargando…');
    const { data: profile, error: profileError } = await supabase.from('callflow_members').select('role').eq('user_id', session.user.id).maybeSingle();
    if (profileError) { setStatus('No se pudo verificar el acceso. Revisa las políticas SQL.'); return; }
    setRole(profile?.role || 'viewer');
    const { data, error } = await supabase.from('callflow_cards').select('*').order('position').order('created_at');
    if (error) { setStatus('No se pudo cargar el panel: ' + error.message); return; }
    const withUrls = await Promise.all((data || []).map(async item => {
      if (!item.audio_path) return { ...item, audio_url: null };
      const { data: urlData, error: urlError } = await supabase.storage.from('callflow-audio').createSignedUrl(item.audio_path, 60 * 60);
      return { ...item, audio_url: urlError ? null : urlData.signedUrl };
    }));
    setItems(withUrls);
    setStatus('');
    const { data: progress } = await supabase.from('callflow_progress').select('card_id, seconds').eq('user_id', session.user.id);
    (progress || []).forEach(p => {
      const el = audioRefs.current[p.card_id];
      if (el) el.dataset.restoreAt = String(p.seconds || 0);
    });
  }

  async function addCard(e) {
    e.preventDefault();
    if (role !== 'admin') return;
    setStatus('Guardando tarjeta…');
    let audioPath = null;
    if (audio) {
      const safeName = audio.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      audioPath = `${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('callflow-audio').upload(audioPath, audio, { contentType: audio.type || 'audio/mpeg', upsert: false });
      if (uploadError) { setStatus('Error al subir audio: ' + uploadError.message); return; }
    }
    const { error } = await supabase.from('callflow_cards').insert({
      title: title.trim() || 'Nueva tarjeta', body: body.trim(), color, audio_path: audioPath, created_by: session.user.id
    });
    if (error) { setStatus('Error al guardar: ' + error.message); return; }
    setTitle(''); setBody(''); setAudio(null);
    const fileInput = document.getElementById('audio-file'); if (fileInput) fileInput.value = '';
    await loadItems();
  }

  async function deleteCard(item) {
    if (role !== 'admin' || !confirm('¿Eliminar esta tarjeta y su audio?')) return;
    if (item.audio_path) await supabase.storage.from('callflow-audio').remove([item.audio_path]);
    const { error } = await supabase.from('callflow_cards').delete().eq('id', item.id);
    setStatus(error ? error.message : 'Tarjeta eliminada.');
    await loadItems();
  }

  async function saveProgress(item, el) {
    if (!session || !el) return;
    const seconds = Math.floor(el.currentTime || 0);
    await supabase.from('callflow_progress').upsert({
      user_id: session.user.id, card_id: item.id, seconds, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,card_id' });
  }

  function restoreProgress(item, el) {
    if (!el || el.dataset.restored === 'yes') return;
    el.dataset.restored = 'yes';
    supabase.from('callflow_progress').select('seconds').eq('user_id', session.user.id).eq('card_id', item.id).maybeSingle()
      .then(({ data }) => {
        if (data?.seconds && Number.isFinite(el.duration) && data.seconds < el.duration) el.currentTime = data.seconds;
        else if (data?.seconds) el.dataset.restoreAt = String(data.seconds);
      });
  }

  if (!supabase) return <main className="setup"><h1>CALLFLOW</h1><p>Falta configurar la conexión a Supabase.</p><p>Copia <code>.env.example</code> a <code>.env.local</code> y completa la URL y la clave pública de tu proyecto.</p></main>;

  if (!session) return <main className="login"><section className="loginbox"><div className="logo">CALL<span>FLOW</span></div><p className="muted">Panel de llamadas y audios</p><form onSubmit={signIn}><label>Correo electrónico</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/><label>Contraseña</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/><button className="primary">Entrar</button></form><p className="hint">El administrador debe invitar o crear las cuentas desde Supabase Auth.</p>{status && <p>{status}</p>}</section></main>;

  return <main className="app">
    <header><div className="logo">CALL<span>FLOW</span></div><div className="headright"><span className="role">{role === 'admin' ? 'ADMINISTRADOR' : 'SOLO LECTURA'}</span><span className="email">{session.user.email}</span><button className="secondary" onClick={signOut}>Salir</button></div></header>
    <section className="intro"><div><p className="eyebrow">PANEL DE COMUNICACIÓN</p><h1>Guiones y audios</h1><p className="muted">Tu contenido y el progreso se guardan en la nube para esta cuenta.</p></div><button className="secondary" onClick={loadItems}>Actualizar</button></section>
    {role === 'admin' && <form className="editor" onSubmit={addCard}><h2>Agregar contenido</h2><div className="formgrid"><div><label>Título</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ej. Saludo inicial" required/></div><div><label>Color de tarjeta</label><select value={color} onChange={e=>setColor(e.target.value)}>{COLORS.map(c=><option key={c} value={c}>{c}</option>)}</select></div></div><label>Texto o guion</label><textarea value={body} onChange={e=>setBody(e.target.value)} rows="3" placeholder="Escribe el párrafo que verá el equipo…"/><label>Archivo de audio</label><input id="audio-file" type="file" accept="audio/*" onChange={e=>setAudio(e.target.files?.[0] || null)}/><button className="primary">Guardar tarjeta</button></form>}
    {status && <p className="status">{status}</p>}
    <section className="cards">{items.map((item, i)=><article className="callcard" key={item.id} style={{'--card-color':item.color || COLORS[i%COLORS.length]}}><div className="cardtop"><span className="index">{String(i+1).padStart(2,'0')}</span>{role==='admin' && <button className="delete" onClick={()=>deleteCard(item)} aria-label="Eliminar tarjeta">Eliminar</button>}</div><h2>{item.title}</h2>{item.body && <p className="cardbody">{item.body}</p>}{item.audio_url ? <div className="player"><audio ref={el=>{if(el) audioRefs.current[item.id]=el;}} controls preload="metadata" src={item.audio_url} onLoadedMetadata={e=>{const el=e.currentTarget; const t=Number(el.dataset.restoreAt||0); if(t>0 && t<el.duration) el.currentTime=t; restoreProgress(item, el);}} onTimeUpdate={e=>{const el=e.currentTarget; if(Math.floor(el.currentTime)%5===0) saveProgress(item,el);}} onPause={e=>saveProgress(item,e.currentTarget)} onEnded={e=>saveProgress(item,e.currentTarget)}/><small>La reproducción se reanuda desde el último progreso guardado en esta cuenta.</small></div> : <p className="noaudio">No hay audio en esta tarjeta.</p>}</article>)}</section>
    {!items.length && !status && <div className="empty">Todavía no hay tarjetas. El administrador puede agregar la primera.</div>}
    <footer>CALLFLOW · Acceso protegido · Audio privado</footer>
  </main>;
}