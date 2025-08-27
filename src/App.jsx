import React, { useMemo, useReducer, useState, useEffect, createContext, useContext } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Select, FormControl, InputLabel, Snackbar, Alert, Switch, FormControlLabel, Box, Typography, Divider, Tooltip, IconButton } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CompressIcon from "@mui/icons-material/Compress";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

/**
 * ====== Simulador de Memoria (MVP) — Todo en Español ======
 *
 * Cambios acordados:
 * - El tamaño del SO por defecto es **10% de la memoria que el usuario asigne**.
 *   Ese SO **NO cuenta dentro de la memoria total** del usuario (solo visible arriba).
 * - Particiones Fijas: el usuario indica N particiones (P1..PN) y captura **cada tamaño**;
 *   la suma debe ser igual a la memoria del usuario (excluyendo SO).
 * - Todo el código (variables/funciones/componentes) en español.
 * - Separación por “módulos” dentro de este archivo para que luego se divida en carpetas:
 *     /estado, /componentes, /paginas, /modos
 *
 * Para probar rápido: pega esto como src/App.jsx. Luego iremos separando por archivos.
 */

// =============================== Estado global ===============================
const PaletaColores = [
  "#0ea5e9", "#22c55e", "#eab308", "#f97316", "#ec4899",
  "#8b5cf6", "#14b8a6", "#f43f5e", "#84cc16", "#06b6d4",
];
const kb = 1;
const idAleatorio = () => Math.random().toString(36).slice(2, 9);
const limitar = (min, v, max) => Math.max(min, Math.min(v, max));
const colorDe = (texto) => {
  const h = Array.from(texto).reduce((a,c)=>a + c.charCodeAt(0), 0);
  return PaletaColores[h % PaletaColores.length];
};

const EstadoContexto = createContext(null);
export const usarEstado = () => useContext(EstadoContexto);

const Acciones = {
  INICIALIZAR_DINAMICAS: "INICIALIZAR_DINAMICAS",
  CAMBIAR_ALGORITMO: "CAMBIAR_ALGORITMO",
  TOGGLE_FIFO_FLEX: "TOGGLE_FIFO_FLEX",
  AGREGAR_PROCESO: "AGREGAR_PROCESO",
  TERMINAR: "TERMINAR",
  COMPACTAR: "COMPACTAR",
  REINICIAR: "REINICIAR",
  INTENTAR_DESDE_ESPERA: "INTENTAR_DESDE_ESPERA",

  // Fijas
  ENTRAR_FIJAS: "ENTRAR_FIJAS",
  CONFIGURAR_FIJAS_MANUAL: "CONFIGURAR_FIJAS_MANUAL",
  AGREGAR_PROCESO_FIJAS: "AGREGAR_PROCESO_FIJAS",
  TERMINAR_FIJAS: "TERMINAR_FIJAS",
};

const uiInicial = { modo: "menu", algoritmo: "firstFit", fifoFlexible: false };
const estadoInicial = {
  ui: uiInicial,
  totalUsuario: 0, // memoria visible del usuario (sin contar SO)
  so: 0,           // SO = 10% de totalUsuario (solo decorativo/visible)

  // Dinámicas
  segmentos: [], // [ {id, tipo: 'os'|'proceso'|'hueco', tamaño, nombre?, color?} ]
  ejecutandoIds: [],
  esperando: [],

  // Fijas
  fijas: { particiones: [] }, // {id, tamaño, usadoPor?}

  // Métricas
  estadisticas: { usada: 0, libre: 0, fragExterna: 0, fragInterna: 0, desperdicio: 0 },
  capturas: [],
  _snack: null,
};

function hacerCaptura(estado, etiqueta){
  const copia = {
    ui: estado.ui,
    totalUsuario: estado.totalUsuario,
    so: estado.so,
    segmentos: estado.segmentos.map(s=>({...s})),
    ejecutandoIds: [...estado.ejecutandoIds],
    esperando: estado.esperando.map(p=>({...p})),
    fijas: { particiones: estado.fijas.particiones.map(p=>({...p})) },
    estadisticas: { ...estado.estadisticas },
    etiqueta,
    ts: Date.now(),
  };
  return copia;
}

function conSnack(estado, mensaje, severidad='success'){
  return { ...estado, _snack: { mensaje, severidad, ts: Date.now() } };
}

function recalc(estado, etiqueta){
  const e = calcularEstadisticas(estado);
  const snap = hacerCaptura({ ...estado, estadisticas: e }, etiqueta);
  return conSnack({ ...estado, estadisticas: e, capturas: [...estado.capturas, snap] }, etiqueta);
}

function reductor(estado, accion){
  switch(accion.tipo){
    // ================= Dinámicas =================
    case Acciones.INICIALIZAR_DINAMICAS: {
      const { totalUsuario } = accion.datos; // la memoria que el usuario define
      const so = Math.floor(totalUsuario * 0.10); // 10% — NO cuenta en métricas
      // Segmentos: mostramos SO arriba (decorativo) + hueco completo del usuario
      const segs = [ { id:"__so__", tipo:"os", tamaño: so, color: "#374151", nombre:"SO" } ];
      if (totalUsuario > 0) segs.push({ id: idAleatorio(), tipo:"hueco", tamaño: totalUsuario });
      const siguiente = { ...estadoInicial, ui: { ...estado.ui, modo: 'dinamicas' }, totalUsuario, so, segmentos: segs };
      return recalc(siguiente, `Inicializado Dinámicas (${totalUsuario}KB + SO ${so}KB)`);
    }
    case Acciones.CAMBIAR_ALGORITMO: {
      return { ...estado, ui: { ...estado.ui, algoritmo: accion.datos } };
    }
    case Acciones.TOGGLE_FIFO_FLEX: {
      return { ...estado, ui: { ...estado.ui, fifoFlexible: !!accion.datos } };
    }
    case Acciones.AGREGAR_PROCESO: {
      const { nombre, tamaño } = accion.datos;
      if (!nombre.trim() || tamaño<=0) return conSnack(estado, 'Datos inválidos', 'error');
      if (estado.esperando.some(p=>p.nombre===nombre) || estado.segmentos.some(s=>s.tipo==='proceso' && s.nombre===nombre)){
        return conSnack(estado, `Nombre duplicado: ${nombre}`, 'error');
      }
      const proceso = { id: idAleatorio(), nombre: nombre.trim(), tamaño: Math.floor(tamaño), color: colorDe(nombre) };
      const { asignado, nuevos } = asignarDinamicas(estado.segmentos, proceso, estado.ui.algoritmo);
      if (asignado){
        const est2 = { ...estado, segmentos: nuevos, ejecutandoIds: [...estado.ejecutandoIds, proceso.id] };
        return intentarDesdeEspera(recalc(est2, `Asignado ${proceso.nombre} (${proceso.tamaño}KB)`));
      }
      const est3 = { ...estado, esperando: [...estado.esperando, proceso] };
      return recalc(est3, `En espera ${proceso.nombre} (${proceso.tamaño}KB)`);
    }
    case Acciones.TERMINAR: {
      const { idProceso } = accion.datos;
      const idx = estado.segmentos.findIndex(s=>s.tipo==='proceso' && s.id===idProceso);
      if (idx===-1) return estado;
      const segs = estado.segmentos.map(s=>({...s}));
      const p = segs[idx];
      segs[idx] = { id: idAleatorio(), tipo:'hueco', tamaño: p.tamaño };
      const siguiente = { ...estado, segmentos: segs, ejecutandoIds: estado.ejecutandoIds.filter(i=>i!==idProceso) };
      return intentarDesdeEspera(recalc(siguiente, `Terminado ${p.nombre}`));
    }
    case Acciones.COMPACTAR: {
      const siguiente = { ...estado, segmentos: compactar(estado.segmentos) };
      return intentarDesdeEspera(recalc(siguiente, 'Compactación'));
    }
    case Acciones.REINICIAR: {
      return { ...estadoInicial, ui: { ...estado.ui, modo: 'menu' } };
    }
    case Acciones.INTENTAR_DESDE_ESPERA: {
      return intentarDesdeEspera(estado);
    }

    // ================= Fijas =================
    case Acciones.ENTRAR_FIJAS: {
      const { totalUsuario } = accion.datos;
      const so = Math.floor(totalUsuario * 0.10);
      return recalc({ ...estadoInicial, ui: { ...estado.ui, modo: 'fijas' }, totalUsuario, so }, `Inicializado Fijas (${totalUsuario}KB + SO ${so}KB)`);
    }
    case Acciones.CONFIGURAR_FIJAS_MANUAL: {
      const { tamaños } = accion.datos; // array de tamaños de P1..PN
      const suma = tamaños.reduce((a,b)=>a+b,0);
      if (suma !== estado.totalUsuario) return conSnack(estado, `La suma (${suma}KB) debe igualar ${estado.totalUsuario}KB`, 'error');
      const particiones = tamaños.map((t, i)=>({ id: idAleatorio(), índice: i+1, tamaño: t, usadoPor: null }));
      const sig = { ...estado, fijas: { particiones } };
      return recalc(sig, `Particiones configuradas (${tamaños.length})`);
    }
    case Acciones.AGREGAR_PROCESO_FIJAS: {
      const { nombre, tamaño } = accion.datos;
      if (!estado.fijas.particiones.length) return conSnack(estado, 'Configura particiones primero', 'warning');
      if (estado.fijas.particiones.some(p=>p.usadoPor?.nombre===nombre) || estado.esperando.some(p=>p.nombre===nombre)) return conSnack(estado, `Nombre duplicado: ${nombre}`, 'error');
      const proceso = { id: idAleatorio(), nombre: nombre.trim(), tamaño: Math.floor(tamaño), color: colorDe(nombre) };
      const cand = estado.fijas.particiones.map(p=>({ ...p, libre: !p.usadoPor && p.tamaño>=proceso.tamaño, desperd: p.tamaño - proceso.tamaño })).filter(p=>p.libre);
      let elegida = null;
      if (estado.ui.algoritmo==='firstFit') elegida = cand[0]||null; else elegida = cand.sort((a,b)=>a.desperd - b.desperd)[0]||null;
      if (!elegida){
        const est2 = { ...estado, esperando: [...estado.esperando, proceso] };
        return recalc(est2, `En espera ${proceso.nombre} (${proceso.tamaño}KB)`);
      }
      const fijas = { particiones: estado.fijas.particiones.map(p=> p.id===elegida.id? { ...p, usadoPor: proceso } : p ) };
      const est3 = { ...estado, fijas, ejecutandoIds: [...estado.ejecutandoIds, proceso.id] };
      return recalc(est3, `Asignado ${proceso.nombre} a P${elegida.índice}`);
    }
    case Acciones.TERMINAR_FIJAS: {
      const { idProceso } = accion.datos;
      const fijas = { particiones: estado.fijas.particiones.map(p=> p.usadoPor?.id===idProceso? { ...p, usadoPor: null } : p ) };
      const est2 = { ...estado, fijas, ejecutandoIds: estado.ejecutandoIds.filter(i=>i!==idProceso) };
      return intentarDesdeEsperaFijas(recalc(est2, 'Terminado (fijas)'));
    }

    default: return estado;
  }
}

// ============================ Utilidades Dinámicas ===========================
const listarHuecos = (segs) => segs.map((s,i)=>({...s, i})).filter(s=>s.tipo==='hueco');
function asignarDinamicas(segmentos, proceso, algoritmo){
  const huecos = listarHuecos(segmentos);
  let elegido = null;
  if (algoritmo==='bestFit') elegido = huecos.filter(h=>h.tamaño>=proceso.tamaño).sort((a,b)=>a.tamaño-b.tamaño)[0]||null;
  else elegido = huecos.find(h=>h.tamaño>=proceso.tamaño)||null;
  if (!elegido) return { asignado:false, nuevos: segmentos };
  const segs = segmentos.map(s=>({...s}));
  const h = segs[elegido.i];
  segs.splice(elegido.i, 1,
    { id: proceso.id, tipo:'proceso', tamaño: proceso.tamaño, nombre: proceso.nombre, color: proceso.color },
    ...(h.tamaño-proceso.tamaño>0? [{ id: idAleatorio(), tipo:'hueco', tamaño: h.tamaño - proceso.tamaño }] : [])
  );
  return { asignado:true, nuevos: segs };
}
function compactar(segmentos){
  const esSO = segmentos[0]?.tipo==='os'? segmentos[0]: null;
  const resto = esSO? segmentos.slice(1): segmentos;
  const procesos = resto.filter(s=>s.tipo==='proceso');
  const totalResto = resto.reduce((a,s)=>a+s.tamaño,0);
  const usada = procesos.reduce((a,s)=>a+s.tamaño,0);
  const hueco = totalResto - usada;
  const nuevoResto = [ ...procesos.map(p=>({...p})), ...(hueco>0?[{ id: idAleatorio(), tipo:'hueco', tamaño: hueco }]:[]) ];
  return esSO? [esSO, ...nuevoResto] : nuevoResto;
}
function intentarDesdeEspera(estado){
  if (!estado.esperando.length) return estado;
  let segs = estado.segmentos.map(s=>({...s}));
  let esperando = [...estado.esperando];
  let ejecutando = [...estado.ejecutandoIds];
  const flex = !!estado.ui.fifoFlexible;
  const alg = estado.ui.algoritmo;
  for (let i=0;i<esperando.length;i++){
    const p = esperando[i];
    const res = asignarDinamicas(segs, p, alg);
    if (res.asignado){
      segs = res.nuevos; ejecutando.push(p.id); esperando.splice(i,1); i--; if (!flex) break;
    }
  }
  return recalc({ ...estado, segmentos: segs, esperando, ejecutando }, 'Intento automático');
}

// =========================== Utilidades Fijas ===============================
function intentarDesdeEsperaFijas(estado){
  if (!estado.esperando.length || !estado.fijas.particiones.length) return estado;
  let esperando = [...estado.esperando];
  let f = { particiones: estado.fijas.particiones.map(p=>({...p})) };
  let ejecutando = [...estado.ejecutandoIds];
  const flex = !!estado.ui.fifoFlexible;
  const alg = estado.ui.algoritmo;
  const intenta = (proc)=>{
    const cand = f.particiones.map(p=>({ ...p, libre: !p.usadoPor && p.tamaño>=proc.tamaño, desperd: p.tamaño-proc.tamaño })).filter(p=>p.libre);
    let e = null; if (alg==='firstFit') e = cand[0]||null; else e = cand.sort((a,b)=>a.desperd-b.desperd)[0]||null;
    if (!e) return false; f.particiones = f.particiones.map(p=> p.id===e.id? { ...p, usadoPor: proc } : p ); ejecutando.push(proc.id); return true;
  };
  for (let i=0;i<esperando.length;i++){
    if (intenta(esperando[i])){ esperando.splice(i,1); i--; if (!flex) break; }
  }
  return recalc({ ...estado, fijas: f, esperando, ejecutando }, 'Intento automático (fijas)');
}

// =============================== Métricas ==================================
function calcularEstadisticas(estado){
  if (estado.ui.modo==='fijas' && estado.fijas.particiones.length){
    const usada = estado.fijas.particiones.reduce((a,p)=>a + (p.usadoPor? p.usadoPor.tamaño:0),0);
    const totalParts = estado.fijas.particiones.reduce((a,p)=>a+p.tamaño,0);
    const libre = totalParts - usada;
    const interna = estado.fijas.particiones.reduce((a,p)=> p.usadoPor? a + (p.tamaño - p.usadoPor.tamaño) : a, 0);
    return { usada, libre, fragExterna: 0, fragInterna: interna, desperdicio: interna };
  }
  // Dinámicas (SO no cuenta):
  const usada = estado.segmentos.filter(s=>s.tipo==='proceso').reduce((a,s)=>a+s.tamaño,0);
  const libre = estado.segmentos.filter(s=>s.tipo==='hueco').reduce((a,s)=>a+s.tamaño,0);
  const menorEnEspera = estado.esperando.length? Math.min(...estado.esperando.map(p=>p.tamaño)) : 0;
  const externa = estado.segmentos.filter(s=>s.tipo==='hueco').filter(h=> menorEnEspera>0? h.tamaño<menorEnEspera:false).reduce((a,h)=>a+h.tamaño,0);
  return { usada, libre, fragExterna: externa, fragInterna: 0, desperdicio: externa };
}

// =============================== App / UI ==================================
export default function App(){
  const [estado, despachar] = useReducer(reductor, estadoInicial);
  const [snack, setSnack] = useState(null);

  useEffect(()=>{ if (estado._snack) setSnack(estado._snack); }, [estado._snack]);

  return (
    <EstadoContexto.Provider value={{ estado, despachar }}>
      <div className="min-h-screen bg-slate-100">
        <Encabezado />
        <main className="max-w-6xl mx-auto p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {estado.ui.modo==='menu' && <PantallaMenu />}
          {estado.ui.modo==='dinamicas' && <ModoDinamicas />}
          {estado.ui.modo==='fijas' && <ModoFijas />}
        </main>
        <Snackbar open={!!snack} autoHideDuration={2200} onClose={()=>setSnack(null)}>
          <Alert severity={snack?.severidad||'info'}>{snack?.mensaje}</Alert>
        </Snackbar>
      </div>
    </EstadoContexto.Provider>
  );
}

function Encabezado(){
  const { estado, despachar } = usarEstado();
  return (
    <div className="bg-white border-b">
      <div className="max-w-6xl mx-auto p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Typography variant="h6">Gestión de Memoria</Typography>
          <Divider orientation="vertical" flexItem />
          <Typography variant="body2" className="text-slate-600">{estado.ui.modo==='menu'? 'Menú' : estado.ui.modo==='dinamicas' ? 'Particiones Dinámicas' : 'Particiones Fijas'}</Typography>
        </div>
        <div className="flex items-center gap-2">
          {estado.ui.modo!=='menu' && (
            <FormControlLabel control={<Switch checked={!!estado.ui.fifoFlexible} onChange={e=>despachar({tipo:Acciones.TOGGLE_FIFO_FLEX, datos:e.target.checked})} />} label="FIFO flexible" />
          )}
          {estado.ui.modo!=='menu' && (
            <IconButton onClick={()=>despachar({tipo:Acciones.REINICIAR})}><RestartAltIcon/></IconButton>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------- Menú --------------------------------------
function PantallaMenu(){
  const { estado, despachar } = usarEstado();
  const [mem, setMem] = useState(512);
  const soCalculado = Math.floor(mem*0.10);

  // Configuración manual de fijas
  const [abrirConfig, setAbrirConfig] = useState(false);
  const [numPart, setNumPart] = useState(4);
  const [tamaños, setTamaños] = useState([100,100,100,100]);

  useEffect(()=>{
    setTamaños(Array.from({length: numPart}, (_,i)=> tamaños[i] ?? Math.floor(mem/numPart)));
  }, [numPart]);

  return (
    <div className="md:col-span-3">
      <Box className="bg-white p-4 rounded-2xl shadow-sm">
        <Typography variant="h6" className="mb-1">Bienvenido, Adolfo</Typography>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Box className="p-4 border rounded-xl">
            <Typography variant="subtitle1" className="mb-2">Parámetros</Typography>
            <div className="grid grid-cols-2 gap-3 items-end">
              <TextField label="Memoria del usuario (KB)" type="number" value={mem} onChange={e=>setMem(Math.max(1, +e.target.value|0))} />
              <div className="text-sm text-slate-500">SO sugerido (10%): {soCalculado} KB (solo visible)</div>
            </div>
          </Box>
          <Box className="p-4 border rounded-xl">
            <Typography variant="subtitle1" className="mb-2">Particiones Fijas (manual)</Typography>
            <div className="grid grid-cols-3 gap-3 items-end">
              <TextField label="# Particiones" type="number" value={numPart} onChange={e=>setNumPart(Math.max(1, +e.target.value|0))} />
              <Button variant="outlined" onClick={()=>setAbrirConfig(true)}>Capturar tamaños…</Button>
              <div className="text-sm text-slate-500">Deben sumar {mem} KB</div>
            </div>
          </Box>
        </div>
        <div className="flex gap-3 mt-4">
          <Button variant="contained" onClick={()=>despachar({tipo:Acciones.INICIALIZAR_DINAMICAS, datos:{ totalUsuario: mem }})}>Entrar a Dinámicas</Button>
          <Button variant="outlined" onClick={()=>{
            despachar({tipo:Acciones.ENTRAR_FIJAS, datos:{ totalUsuario: mem }});
            // guardamos tamaños si ya cuadran
            const suma = tamaños.reduce((a,b)=>a+b,0);
            if (suma === mem) despachar({tipo:Acciones.CONFIGURAR_FIJAS_MANUAL, datos:{ tamaños }});
          }}>Entrar a Fijas</Button>
        </div>
      </Box>

      <Dialog open={abrirConfig} onClose={()=>setAbrirConfig(false)} fullWidth maxWidth="sm">
        <DialogTitle>Capturar tamaños de particiones (deben sumar {mem} KB)</DialogTitle>
        <DialogContent>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {Array.from({length:numPart}).map((_,i)=> (
              <TextField key={i} label={`P${i+1} (KB)`} type="number" value={tamaños[i]||0} onChange={e=>{
                const v = Math.max(1, +e.target.value|0); const arr=[...tamaños]; arr[i]=v; setTamaños(arr);
              }} />
            ))}
          </div>
          <div className="mt-2 text-sm text-slate-600">Suma: {tamaños.reduce((a,b)=>a+b,0)} KB</div>
        </DialogContent>
        <DialogActions>
          <Button onClick={()=>setAbrirConfig(false)}>Cancelar</Button>
          <Button variant="contained" onClick={()=>{
            const suma = tamaños.reduce((a,b)=>a+b,0);
            if (suma!==mem) return alert(`La suma (${suma}) debe igualar ${mem}`);
            // entrar a fijas + configurar
            setAbrirConfig(false);
          }}>Aceptar</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

// ----------------------------- Dinámicas -----------------------------------
function ModoDinamicas(){
  const { estado, despachar } = usarEstado();
  const [nombre, setNombre] = useState("");
  const [tamaño, setTamaño] = useState(10);
  const procesosEjecutando = estado.segmentos.filter(s=>s.tipo==='proceso');

  return (
    <>
      <div className="bg-white p-4 rounded-2xl shadow-sm">
        <Typography variant="subtitle1" className="mb-3">Controles</Typography>
        <FormControl fullWidth className="mb-3">
          <InputLabel>Algoritmo</InputLabel>
          <Select value={estado.ui.algoritmo} label="Algoritmo" onChange={e=>despachar({tipo:Acciones.CAMBIAR_ALGORITMO, datos:e.target.value})}>
            <MenuItem value="firstFit">First Fit</MenuItem>
            <MenuItem value="bestFit">Best Fit</MenuItem>
          </Select>
        </FormControl>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <TextField label="Nombre" value={nombre} onChange={e=>setNombre(e.target.value)} />
          <TextField label="Tamaño (KB)" type="number" value={tamaño} onChange={e=>setTamaño(Math.max(1, +e.target.value|0))} />
        </div>
        <div className="flex gap-2">
          <Button variant="contained" onClick={()=>{ if(!nombre.trim())return; despachar({tipo:Acciones.AGREGAR_PROCESO, datos:{ nombre:nombre.trim(), tamaño }}); setNombre(""); }}>Agregar</Button>
          <Button color="secondary" variant="outlined" startIcon={<CompressIcon/>} onClick={()=>despachar({tipo:Acciones.COMPACTAR})}>Compactar</Button>
          <Button variant="text" color="inherit" startIcon={<RestartAltIcon/>} onClick={()=>despachar({tipo:Acciones.REINICIAR})}>Reset</Button>
        </div>
      </div>

      <div className="md:col-span-2 space-y-4">
        <Box className="bg-white p-4 rounded-2xl shadow-sm">
          <div className="flex items-start gap-6">
            <BarraMemoria totalUsuario={estado.totalUsuario} so={estado.so} segmentos={estado.segmentos} />
            <PanelEstadisticas e={estado.estadisticas} totalUsuario={estado.totalUsuario} so={estado.so} modo="dinamicas" />
          </div>
        </Box>
        <Box className="bg-white p-4 rounded-2xl shadow-sm">
          <Typography variant="subtitle1" className="mb-2">Procesos</Typography>
          <div className="grid grid-cols-2 gap-4">
            <TablaProcesos titulo="En ejecución" filas={procesosEjecutando} seleccionable onTerminar={(id)=>despachar({tipo:Acciones.TERMINAR, datos:{ idProceso:id }})} />
            <TablaProcesos titulo="En espera" filas={estado.esperando} />
          </div>
        </Box>
        <PanelCapturas capturas={estado.capturas} />
      </div>
    </>
  );
}

// ------------------------------- Fijas -------------------------------------
function ModoFijas(){
  const { estado, despachar } = usarEstado();
  const [nombre, setNombre] = useState("");
  const [tamaño, setTamaño] = useState(10);
  const ejecutando = estado.fijas.particiones.filter(p=>p.usadoPor).map(p=>p.usadoPor);

  return (
    <>
      <div className="bg-white p-4 rounded-2xl shadow-sm">
        <Typography variant="subtitle1" className="mb-3">Controles</Typography>
        <FormControl fullWidth className="mb-3">
          <InputLabel>Algoritmo</InputLabel>
          <Select value={estado.ui.algoritmo} label="Algoritmo" onChange={e=>despachar({tipo:Acciones.CAMBIAR_ALGORITMO, datos:e.target.value})}>
            <MenuItem value="firstFit">First Fit</MenuItem>
            <MenuItem value="bestFit">Best Fit</MenuItem>
          </Select>
        </FormControl>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <TextField label="Nombre" value={nombre} onChange={e=>setNombre(e.target.value)} />
          <TextField label="Tamaño (KB)" type="number" value={tamaño} onChange={e=>setTamaño(Math.max(1, +e.target.value|0))} />
        </div>
        <div className="flex gap-2">
          <Button variant="contained" onClick={()=>{ if(!nombre.trim())return; despachar({tipo:Acciones.AGREGAR_PROCESO_FIJAS, datos:{ nombre:nombre.trim(), tamaño }}); setNombre(""); }}>Agregar</Button>
        </div>
      </div>

      <div className="md:col-span-2 space-y-4">
        <Box className="bg-white p-4 rounded-2xl shadow-sm">
          <div className="flex items-start gap-6">
            <BarraMemoriaFijas totalUsuario={estado.totalUsuario} so={estado.so} particiones={estado.fijas.particiones} />
            <PanelEstadisticas e={estado.estadisticas} totalUsuario={estado.totalUsuario} so={estado.so} modo="fijas" />
          </div>
        </Box>
        <Box className="bg-white p-4 rounded-2xl shadow-sm">
          <Typography variant="subtitle1" className="mb-2">Procesos</Typography>
          <div className="grid grid-cols-2 gap-4">
            <TablaProcesos titulo="En ejecución" filas={ejecutando} onTerminar={(id)=>despachar({tipo:Acciones.TERMINAR_FIJAS, datos:{ idProceso:id }})} seleccionable />
            <TablaProcesos titulo="En espera" filas={estado.esperando} />
          </div>
        </Box>
        <PanelCapturas capturas={estado.capturas} />
      </div>
    </>
  );
}

// ================================ Widgets ==================================
function BarraMemoria({ totalUsuario, so, segmentos }){
  const ocultarEtiquetaPct = 1; // <1% se oculta
  const totalVisual = so + totalUsuario;
  return (
    <div className="w-32 h-96 border rounded-xl overflow-hidden relative">
      {/* SO arriba, no participa en métricas */}
      <div style={{ height: `${(so/totalVisual)*100}%`, background:'#1f2937' }} className="w-full border-b flex items-center justify-center text-[10px] text-white/90">SO</div>
      {segmentos.filter(s=>s.tipo!=='os').map((s,i)=>{
        const pct = (s.tamaño/totalVisual)*100;
        const alto = `${pct}%`;
        const esHueco = s.tipo==='hueco';
        const fondo = esHueco? 'repeating-linear-gradient(45deg,#e5e7eb, #e5e7eb 6px, #f3f4f6 6px, #f3f4f6 12px)' : (s.color||'#93c5fd');
        const etiqueta = esHueco? `${s.tamaño}KB libre` : `${s.nombre} (${s.tamaño}KB)`;
        return (
          <Tooltip key={s.id} title={etiqueta} placement="right">
            <div style={{ height: alto, background: fondo }} className="w-full border-b last:border-b-0 flex items-center justify-center text-[10px] text-slate-800">
              {pct>=ocultarEtiquetaPct && !esHueco && <span className="text-white/90">{s.nombre}</span>}
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function BarraMemoriaFijas({ totalUsuario, so, particiones }){
  const totalVisual = so + totalUsuario;
  return (
    <div className="w-32 h-96 border rounded-xl overflow-hidden relative">
      <div style={{ height: `${(so/totalVisual)*100}%`, background:'#1f2937' }} className="w-full border-b flex items-center justify-center text-[10px] text-white/90">SO</div>
      {particiones.map(p=>{
        const pct = (p.tamaño/totalVisual)*100;
        const fondo = p.usadoPor? p.usadoPor.color : 'repeating-linear-gradient(45deg,#e5e7eb, #e5e7eb 6px, #f3f4f6 6px, #f3f4f6 12px)';
        const etiqueta = p.usadoPor? `${p.usadoPor.nombre} (${p.usadoPor.tamaño}KB)` : `${p.tamaño}KB libre`;
        return (
          <Tooltip key={p.id} title={`P${p.índice}: ${etiqueta}`} placement="right">
            <div style={{ height: `${pct}%`, background: fondo }} className="w-full border-b last:border-b-0 flex items-center justify-center text-[10px] text-slate-800">
              {p.usadoPor && <span className="text-white/90">{p.usadoPor.nombre}</span>}
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function PanelEstadisticas({ e, totalUsuario, so }){
  return (
    <div className="flex-1 grid grid-cols-2 gap-3">
      <TarjetaEstadística etiqueta="Memoria usuario" valor={`${totalUsuario} KB`} />
      <TarjetaEstadística etiqueta="SO (visual)" valor={`${so} KB`} />
      <TarjetaEstadística etiqueta="Usada" valor={`${e.usada} KB`} />
      <TarjetaEstadística etiqueta="Libre" valor={`${e.libre} KB`} />
      <TarjetaEstadística etiqueta="Frag. Externa" valor={`${e.fragExterna} KB`} />
      <TarjetaEstadística etiqueta="Frag. Interna" valor={`${e.fragInterna} KB`} />
      <TarjetaEstadística etiqueta="Desperdicio Total" valor={`${e.desperdicio} KB`} />
    </div>
  );
}
function TarjetaEstadística({ etiqueta, valor }){
  return (
    <div className="p-3 rounded-xl border">
      <div className="text-xs text-slate-500">{etiqueta}</div>
      <div className="text-lg font-medium">{valor}</div>
    </div>
  );
}

function TablaProcesos({ titulo, filas, seleccionable=false, onTerminar }){
  const [sel, setSel] = useState(null);
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b text-sm font-medium flex items-center justify-between">
        <span>{titulo}</span>
        {seleccionable && sel && <Button size="small" color="error" startIcon={<DeleteOutlineIcon/>} onClick={()=>{ onTerminar?.(sel); setSel(null); }}>Terminar</Button>}
      </div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-left"><th className="px-2 py-1">Nombre</th><th className="px-2 py-1">Tamaño</th></tr>
          </thead>
          <tbody>
            {filas.length===0 && <tr><td colSpan={2} className="px-2 py-2 text-slate-400">Vacío</td></tr>}
            {filas.map(p=> (
              <tr key={p.id} className={`hover:bg-slate-50 ${seleccionable?'cursor-pointer':''} ${sel===p.id?'bg-sky-50':''}`} onClick={()=> seleccionable && setSel(p.id)}>
                <td className="px-2 py-1">{p.nombre}</td>
                <td className="px-2 py-1">{p.tamaño} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PanelCapturas({ capturas }){
  return (
    <div className="md:col-span-3 bg-white p-4 rounded-2xl shadow-sm">
      <Typography variant="subtitle1" className="mb-2">Historial</Typography>
      <div className="flex gap-2 overflow-x-auto">
        {capturas.map(c=> (
          <div key={c.ts} className="min-w-[220px] p-2 border rounded-lg text-xs">
            <div className="font-medium mb-1">{new Date(c.ts).toLocaleTimeString()} · {c.etiqueta}</div>
            <div>Usuario: {c.total} KB</div>
          </div>
        ))}
      </div>
    </div>
  );
}
