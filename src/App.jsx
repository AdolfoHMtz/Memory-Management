import React, { useMemo, useReducer, useState, useEffect, createContext, useContext } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, Select, FormControl, InputLabel, Snackbar, Alert, Switch, FormControlLabel, Box, Typography, Divider, Tooltip, IconButton, Chip } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CompressIcon from "@mui/icons-material/Compress";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

/**
 * ====== Simulador de Memoria (MVP v2 corregido) — Español ======
 *
 * Correcciones aplicadas según tu lista:
 * 1) Inputs sin valores por defecto; validaciones y alertas.
 * 2) En captura de fijas se muestra **KB restantes** por asignar (no la suma).
 * 3) Fijas: particiones con **borde claro**; si hay proceso, se **llena proporcional** al uso
 *    y el sobrante de la partición muestra patrón rojo/blanco (fragmentación interna) distinto
 *    del patrón de "partición vacía".
 * 4) Tablas: **botón por fila** para eliminar/terminar; en espera muestra mensajes:
 *    - Fijas: “demasiado grande para las particiones”.
 *    - Dinámicas: “en espera por falta de memoria” o “por fragmentación externa”.
 * 5) Panel de métricas:
 *    - Quitado el card de SO.
 *    - Dinámicas: solo **Externa**; Interna oculta.
 *    - Fijas: solo **Interna**; Externa oculta. Se añade **Desperdicio particiones vacías**
 *      y **Desperdicio total = interna + vacías**.
 * 6) FIFO flexible/arreglo: estricto = **solo intenta el primero**; flexible = intenta con
 *    todos los que quepan (orden de llegada preservado).
 * 7) Fijas: etiqueta dentro de bloque **Nombre (tamañoKB)**; Tooltip multilínea:
 *      Partición N: (XKB) 
 Proceso: (YKB)
 * 8) Dinámicas: cálculo de **fragmentación externa** corregido: solo si la **memoria libre total ≥
 *    tamaño del menor en espera** y **ningún hueco es suficiente**. Se añaden razones de espera.
 */

// =============================== Estado global ===============================
const PaletaColores = [
  "#0ea5e9", "#22c55e", "#eab308", "#f97316", "#ec4899",
  "#8b5cf6", "#14b8a6", "#f43f5e", "#84cc16", "#06b6d4",
];
const idAleatorio = () => Math.random().toString(36).slice(2, 9);
const limitar = (min, v, max) => Math.max(min, Math.min(v, max));
const colorDe = (texto) => { const h = Array.from(texto).reduce((a,c)=>a + c.charCodeAt(0), 0); return PaletaColores[h % PaletaColores.length]; };

const EstadoContexto = createContext(null);
export const usarEstado = () => useContext(EstadoContexto);

const Acciones = {
  INICIALIZAR_DINAMICAS: "INICIALIZAR_DINAMICAS",
  ENTRAR_FIJAS: "ENTRAR_FIJAS",
  CONFIGURAR_FIJAS_MANUAL: "CONFIGURAR_FIJAS_MANUAL",

  CAMBIAR_ALGORITMO: "CAMBIAR_ALGORITMO",
  TOGGLE_FIFO_FLEX: "TOGGLE_FIFO_FLEX",

  AGREGAR_PROCESO: "AGREGAR_PROCESO",
  TERMINAR: "TERMINAR",
  COMPACTAR: "COMPACTAR",
  ELIMINAR_ESPERA: "ELIMINAR_ESPERA",

  AGREGAR_PROCESO_FIJAS: "AGREGAR_PROCESO_FIJAS",
  TERMINAR_FIJAS: "TERMINAR_FIJAS",

  REINICIAR: "REINICIAR",
  INTENTAR_DESDE_ESPERA: "INTENTAR_DESDE_ESPERA",
};

const uiInicial = { modo: "menu", algoritmo: "firstFit", fifoFlexible: false };
const estadoInicial = {
  ui: uiInicial,
  totalUsuario: 0, // memoria del usuario (sin SO)
  so: 0,           // 10% visual

  // Dinámicas
  segmentos: [], // [ {id, tipo: 'os'|'proceso'|'hueco', tamaño, nombre?, color?} ]
  ejecutandoIds: [],
  esperando: [],

  // Fijas
  fijas: { particiones: [] }, // {id, índice, tamaño, usadoPor?}

  // Métricas
  estadisticas: { usada: 0, libre: 0, fragExterna: 0, fragInterna: 0, desperdicioVacias: 0, desperdicio: 0 },
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
    // ================= Menú / Inicio =================
    case Acciones.INICIALIZAR_DINAMICAS: {
      const { totalUsuario } = accion.datos; if (!Number.isFinite(totalUsuario) || totalUsuario<=0) return conSnack(estado, 'Ingresa memoria válida', 'error');
      const so = Math.floor(totalUsuario * 0.10);
      const segs = [ { id:"__so__", tipo:"os", tamaño: so, color: "#374151", nombre:"SO" } ];
      if (totalUsuario > 0) segs.push({ id: idAleatorio(), tipo:"hueco", tamaño: totalUsuario });
      const siguiente = { ...estadoInicial, ui: { ...estado.ui, modo: 'dinamicas' }, totalUsuario, so, segmentos: segs };
      return recalc(siguiente, `Inicializado Dinámicas (${totalUsuario}KB + SO ${so}KB)`);
    }
    case Acciones.ENTRAR_FIJAS: {
      const { totalUsuario } = accion.datos; if (!Number.isFinite(totalUsuario) || totalUsuario<=0) return conSnack(estado, 'Ingresa memoria válida', 'error');
      const so = Math.floor(totalUsuario * 0.10);
      return recalc({ ...estadoInicial, ui: { ...estado.ui, modo: 'fijas' }, totalUsuario, so }, `Inicializado Fijas (${totalUsuario}KB + SO ${so}KB)`);
    }
    case Acciones.CONFIGURAR_FIJAS_MANUAL: {
      const { tamaños } = accion.datos;
      const suma = tamaños.reduce((a,b)=>a+b,0);
      if (suma !== estado.totalUsuario) return conSnack(estado, `Restan ${estado.totalUsuario - suma} KB por ajustar`, 'error');
      const particiones = tamaños.map((t, i)=>({ id: idAleatorio(), índice: i+1, tamaño: t, usadoPor: null }));
      const sig = { ...estado, fijas: { particiones } };
      return recalc(sig, `Particiones configuradas (${tamaños.length})`);
    }

    // ================ Configuración común =================
    case Acciones.CAMBIAR_ALGORITMO: return { ...estado, ui: { ...estado.ui, algoritmo: accion.datos } };
    case Acciones.TOGGLE_FIFO_FLEX: return { ...estado, ui: { ...estado.ui, fifoFlexible: !!accion.datos } };

    // ================= Dinámicas =================
    case Acciones.AGREGAR_PROCESO: {
      const { nombre, tamaño } = accion.datos;
      if (!nombre?.trim() || !Number.isFinite(tamaño) || tamaño<=0) return conSnack(estado, 'Completa nombre y tamaño', 'error');
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
    case Acciones.ELIMINAR_ESPERA: {
      const { idProceso } = accion.datos;
      return recalc({ ...estado, esperando: estado.esperando.filter(p=>p.id!==idProceso) }, 'Eliminado de espera');
    }

    // ================= Fijas =================
    case Acciones.AGREGAR_PROCESO_FIJAS: {
      const { nombre, tamaño } = accion.datos;
      if (!nombre?.trim() || !Number.isFinite(tamaño) || tamaño<=0) return conSnack(estado, 'Completa nombre y tamaño', 'error');
      if (!estado.fijas.particiones.length) return conSnack(estado, 'Configura particiones primero', 'warning');
      if (estado.fijas.particiones.some(p=>p.usadoPor?.nombre===nombre) || estado.esperando.some(p=>p.nombre===nombre)) return conSnack(estado, `Nombre duplicado: ${nombre}`, 'error');
      const proceso = { id: idAleatorio(), nombre: nombre.trim(), tamaño: Math.floor(tamaño), color: colorDe(nombre) };
      const cand = estado.fijas.particiones.map(p=>({ ...p, libre: !p.usadoPor && p.tamaño>=proceso.tamaño, desperd: p.tamaño - proceso.tamaño })).filter(p=>p.libre);
      let elegida = null; if (estado.ui.algoritmo==='firstFit') elegida = cand[0]||null; else elegida = cand.sort((a,b)=>a.desperd-b.desperd)[0]||null;
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

    // ================= Misc =================
    case Acciones.REINICIAR: return { ...estadoInicial, ui: { ...estado.ui, modo: 'menu' } };
    case Acciones.INTENTAR_DESDE_ESPERA: return intentarDesdeEspera(estado);

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
  const flex = !!estado.ui.fifoFlexible; // flexible: probar con todos
  const alg = estado.ui.algoritmo;

  if (!flex){
    // ESTRICTO: solo intenta el PRIMERO
    const p = esperando[0];
    const res = asignarDinamicas(segs, p, alg);
    if (res.asignado){ segs = res.nuevos; ejecutando.push(p.id); esperando.shift(); }
    return recalc({ ...estado, segmentos: segs, esperando, ejecutando }, 'Intento (FIFO estricto)');
  }
  // FLEXIBLE: intenta con todos los que quepan
  for (let i=0;i<esperando.length;i++){
    const p = esperando[i];
    const res = asignarDinamicas(segs, p, alg);
    if (res.asignado){ segs = res.nuevos; ejecutando.push(p.id); esperando.splice(i,1); i--; }
  }
  return recalc({ ...estado, segmentos: segs, esperando, ejecutando }, 'Intento (FIFO flexible)');
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
  if (!flex){
    const p = esperando[0]; if (intenta(p)) esperando.shift();
  } else {
    for (let i=0;i<esperando.length;i++){ if (intenta(esperando[i])){ esperando.splice(i,1); i--; } }
  }
  return recalc({ ...estado, fijas: f, esperando, ejecutando }, flex? 'Intento (flexible fijas)' : 'Intento (estricto fijas)');
}

// =============================== Métricas ==================================
function calcularEstadisticas(estado){
  if (estado.ui.modo==='fijas' && estado.fijas.particiones.length){
    const usada = estado.fijas.particiones.reduce((a,p)=>a + (p.usadoPor? p.usadoPor.tamaño:0),0);
    const totalParts = estado.fijas.particiones.reduce((a,p)=>a+p.tamaño,0);
    const libreInterno = estado.fijas.particiones.reduce((a,p)=> p.usadoPor? a + (p.tamaño - p.usadoPor.tamaño) : a, 0);
    const vacias = estado.fijas.particiones.filter(p=>!p.usadoPor).reduce((a,p)=>a+p.tamaño,0);
    const libre = libreInterno + vacias;
    const interna = libreInterno;
    const desperdicioVacias = vacias;
    const desperdicio = interna + desperdicioVacias;
    return { usada, libre, fragExterna: 0, fragInterna: interna, desperdicioVacias, desperdicio };
  }
  // Dinámicas (SO no cuenta):
  const usada = estado.segmentos.filter(s=>s.tipo==='proceso').reduce((a,s)=>a+s.tamaño,0);
  const huecos = estado.segmentos.filter(s=>s.tipo==='hueco');
  const libre = huecos.reduce((a,s)=>a+s.tamaño,0);
  const menorEnEspera = estado.esperando.length? Math.min(...estado.esperando.map(p=>p.tamaño)) : 0;
  const maxHueco = huecos.length? Math.max(...huecos.map(h=>h.tamaño)) : 0;
  let externa = 0;
  if (menorEnEspera>0 && libre >= menorEnEspera && maxHueco < menorEnEspera){
    // hay memoria suficiente en total, pero fragmentada
    externa = huecos.reduce((a,h)=>a+h.tamaño,0);
  }
  return { usada, libre, fragExterna: externa, fragInterna: 0, desperdicioVacias: 0, desperdicio: externa };
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
          <Typography variant="h6">Gestión de Memoria Perrines Pro Plus Max </Typography>
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
  const [memTexto, setMemTexto] = useState(""); // sin valor por defecto
  const mem = memTexto===""? NaN : +memTexto; // para validación
  const soCalculado = Number.isFinite(mem)? Math.floor(mem*0.10) : 0;

  // Configuración manual de fijas
  const [abrirConfig, setAbrirConfig] = useState(false);
  const [numPartTexto, setNumPartTexto] = useState("");
  const numPart = numPartTexto===""? NaN : +numPartTexto;
  const [tamaños, setTamaños] = useState([]);

  const restante = Number.isFinite(mem)? mem - (tamaños.reduce((a,b)=>a+b,0) || 0) : 0;

  useEffect(()=>{
    if (Number.isFinite(numPart) && numPart>0){ setTamaños(Array.from({length: numPart}, ()=> 0)); }
    else setTamaños([]);
  }, [numPartTexto]);

  return (
    <div className="md:col-span-3">
      <Box className="bg-white p-4 rounded-2xl shadow-sm">
        <Typography variant="h6" className="mb-1">Ingresa el tamaño de la memoria (KB)</Typography>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Box className="p-4 border rounded-xl">
            <Typography variant="subtitle1" className="mb-2">Parámetros</Typography>
            <div className="grid grid-cols-2 gap-3 items-end">
              <TextField label="Memoria del usuario (KB)" type="number" value={memTexto} onChange={e=>setMemTexto(e.target.value)} />
              <div className="text-sm text-slate-500">SO sugerido (10%): {soCalculado||0} KB (solo visible)</div>
            </div>
          </Box>
          <Box className="p-4 border rounded-xl">
            <Typography variant="subtitle1" className="mb-2">Particiones Fijas (manual)</Typography>
            <div className="grid grid-cols-3 gap-3 items-end">
              <TextField label="# Particiones" type="number" value={numPartTexto} onChange={e=>setNumPartTexto(e.target.value)} />
              <Button variant="outlined" onClick={()=>{
                if (!Number.isFinite(mem) || mem<=0) return alert('Ingresa memoria válida primero');
                if (!Number.isFinite(numPart) || numPart<=0) return alert('Ingresa número de particiones');
                setAbrirConfig(true);
              }}>Capturar tamaños…</Button>
              <div className="text-sm text-slate-500">Restante por asignar: {Math.max(0, restante)} KB</div>
            </div>
          </Box>
        </div>
        <div className="flex gap-3 mt-4">
          <Button variant="contained" onClick={()=>{
            if (!Number.isFinite(mem) || mem<=0) return alert('Ingresa memoria válida');
            despachar({tipo:Acciones.INICIALIZAR_DINAMICAS, datos:{ totalUsuario: mem }});
          }}>Entrar a Dinámicas</Button>
          <Button variant="outlined" onClick={()=>{
            if (!Number.isFinite(mem) || mem<=0) return alert('Ingresa memoria válida');
            despachar({tipo:Acciones.ENTRAR_FIJAS, datos:{ totalUsuario: mem }});
            if (tamaños.length && tamaños.reduce((a,b)=>a+b,0)===mem){
              despachar({tipo:Acciones.CONFIGURAR_FIJAS_MANUAL, datos:{ tamaños }});
            }
          }}>Entrar a Fijas</Button>
        </div>
      </Box>

      <Dialog open={abrirConfig} onClose={()=>setAbrirConfig(false)} fullWidth maxWidth="sm">
        <DialogTitle>Capturar tamaños (deben sumar {mem||0} KB)</DialogTitle>
        <DialogContent>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {tamaños.map((val,i)=> (
              <TextField key={i} label={`P${i+1} (KB)`} type="number" value={val} onChange={e=>{
                const v = Math.max(0, +e.target.value || 0); const arr=[...tamaños]; arr[i]=v; setTamaños(arr);
              }} />
            ))}
          </div>
          <div className="mt-2 text-sm text-slate-600">Restante por asignar: {Math.max(0, (mem||0) - (tamaños.reduce((a,b)=>a+b,0)||0))} KB</div>
        </DialogContent>
        <DialogActions>
          <Button onClick={()=>setAbrirConfig(false)}>Cancelar</Button>
          <Button variant="contained" onClick={()=>{
            const suma = tamaños.reduce((a,b)=>a+b,0);
            if (suma!==mem) return alert(`Faltan ${mem - suma} KB por asignar`);
            despachar({tipo:Acciones.CONFIGURAR_FIJAS_MANUAL, datos:{ tamaños }});
            setAbrirConfig(false);
          }}>Guardar</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

// ----------------------------- Dinámicas -----------------------------------
function ModoDinamicas(){
  const { estado, despachar } = usarEstado();
  const [nombre, setNombre] = useState("");
  const [tamañoTexto, setTamañoTexto] = useState("");
  const tamaño = tamañoTexto===""? NaN : +tamañoTexto;

  const procesosEjecutando = estado.segmentos.filter(s=>s.tipo==='proceso');
  const huecos = estado.segmentos.filter(s=>s.tipo==='hueco');
  const libreTotal = huecos.reduce((a,h)=>a+h.tamaño,0);
  const maxHueco = huecos.length? Math.max(...huecos.map(h=>h.tamaño)) : 0;

  // razones para los de espera
  const filasEspera = estado.esperando.map(p=>{
    let nota = '';
    if (p.tamaño > libreTotal) nota = ' (en espera por falta de memoria)';
    else if (p.tamaño > maxHueco) nota = ' (en espera por fragmentación externa)';
    return { ...p, nota };
  });

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
          <TextField label="Tamaño (KB)" type="number" value={tamañoTexto} onChange={e=>setTamañoTexto(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="contained" onClick={()=>{ if(!nombre.trim() || !Number.isFinite(tamaño) || tamaño<=0) return alert('Completa nombre y tamaño (>0)'); despachar({tipo:Acciones.AGREGAR_PROCESO, datos:{ nombre:nombre.trim(), tamaño }}); setNombre(""); setTamañoTexto(""); }}>Agregar</Button>
          <Button color="secondary" variant="outlined" startIcon={<CompressIcon/>} onClick={()=>despachar({tipo:Acciones.COMPACTAR})}>Compactar</Button>
          <Button variant="text" color="inherit" startIcon={<RestartAltIcon/>} onClick={()=>despachar({tipo:Acciones.REINICIAR})}>Reset</Button>
        </div>
      </div>

      <div className="md:col-span-2 space-y-4">
        <Box className="bg-white p-4 rounded-2xl shadow-sm">
          <div className="flex items-start gap-6">
            <BarraMemoria totalUsuario={estado.totalUsuario} so={estado.so} segmentos={estado.segmentos} />
            <PanelEstadisticas e={estado.estadisticas} modo="dinamicas" />
          </div>
        </Box>
        <Box className="bg-white p-4 rounded-2xl shadow-sm">
          <Typography variant="subtitle1" className="mb-2">Procesos</Typography>
          <div className="grid grid-cols-2 gap-4">
            <TablaProcesos titulo="En ejecución" filas={procesosEjecutando} botonAccion={{ etiqueta:'Terminar', color:'error', onClick:(id)=>despachar({tipo:Acciones.TERMINAR, datos:{ idProceso:id }}) }} />
            <TablaProcesos titulo="En espera" filas={filasEspera} botonAccion={{ etiqueta:'Eliminar', color:'inherit', onClick:(id)=>despachar({tipo:Acciones.ELIMINAR_ESPERA, datos:{ idProceso:id }}) }} mostrarNota />
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
  const [tamañoTexto, setTamañoTexto] = useState("");
  const tamaño = tamañoTexto===""? NaN : +tamañoTexto;

  const ejecutando = estado.fijas.particiones.filter(p=>p.usadoPor).map(p=>p.usadoPor);
  const maxPart = estado.fijas.particiones.length? Math.max(...estado.fijas.particiones.map(p=>p.tamaño)) : 0;
  const filasEspera = estado.esperando.map(p=> ({ ...p, nota: (p.tamaño>maxPart? ' (demasiado grande para las particiones)': '') }));

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
          <TextField label="Tamaño (KB)" type="number" value={tamañoTexto} onChange={e=>setTamañoTexto(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant="contained" onClick={()=>{ if(!nombre.trim() || !Number.isFinite(tamaño) || tamaño<=0) return alert('Completa nombre y tamaño (>0)'); despachar({tipo:Acciones.AGREGAR_PROCESO_FIJAS, datos:{ nombre:nombre.trim(), tamaño }}); setNombre(""); setTamañoTexto(""); }}>Agregar</Button>
        </div>
      </div>

      <div className="md:col-span-2 space-y-4">
        <Box className="bg-white p-4 rounded-2xl shadow-sm">
          <div className="flex items-start gap-6">
            <BarraMemoriaFijas totalUsuario={estado.totalUsuario} so={estado.so} particiones={estado.fijas.particiones} />
            <PanelEstadisticas e={estado.estadisticas} modo="fijas" />
          </div>
        </Box>
        <Box className="bg-white p-4 rounded-2xl shadow-sm">
          <Typography variant="subtitle1" className="mb-2">Procesos</Typography>
          <div className="grid grid-cols-2 gap-4">
            <TablaProcesos titulo="En ejecución" filas={ejecutando} botonAccion={{ etiqueta:'Terminar', color:'error', onClick:(id)=>despachar({tipo:Acciones.TERMINAR_FIJAS, datos:{ idProceso:id }}) }} />
            <TablaProcesos titulo="En espera" filas={filasEspera} botonAccion={{ etiqueta:'Eliminar', color:'inherit', onClick:(id)=>despachar({tipo:Acciones.ELIMINAR_ESPERA, datos:{ idProceso:id }}) }} mostrarNota />
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
      <div style={{ height: `${(so/totalVisual)*100}%`, background:'#1f2937' }} className="w-full border-b-2 border-black flex items-center justify-center text-[10px] text-white/90">SO</div>
      {segmentos.filter(s=>s.tipo!=='os').map((s)=>{
        const pct = (s.tamaño/totalVisual)*100;
        const alto = `${pct}%`;
        const esHueco = s.tipo==='hueco';
        const fondo = esHueco? 'repeating-linear-gradient(45deg,#e5e7eb, #e5e7eb 6px, #f3f4f6 6px, #f3f4f6 12px)' : (s.color||'#93c5fd');
        const etiqueta = esHueco? `${s.tamaño}KB libre` : `${s.nombre} (${s.tamaño}KB)`;
        return (
          <Tooltip key={s.id} title={etiqueta} placement="right">
            <div style={{ height: alto, background: fondo }} className="w-full border-b last:border-b-0 flex items-center justify-center text-[10px] text-slate-800">
              {pct>=ocultarEtiquetaPct && !esHueco && <span className="text-white/90">{s.nombre} ({s.tamaño}KB)</span>}
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
    <div className="w-40 h-96 border rounded-xl overflow-hidden relative">
      <div style={{ height: `${(so/totalVisual)*100}%`, background:'#1f2937' }} className="w-full border-b-2 border-black flex items-center justify-center text-[10px] text-white/90">SO</div>
      {particiones.map(p=>{
        const pctContenedor = (p.tamaño/totalVisual)*100;
        const usado = p.usadoPor?.tamaño || 0;
        const pctUsado = p.tamaño>0 ? (usado/p.tamaño)*100 : 0;
        const hayProceso = !!p.usadoPor;
        const tooltip = (
          <div>
            <div><b>Partición {p.índice}:</b> {p.tamaño}KB</div>
            {hayProceso ? <div><b>{p.usadoPor.nombre}:</b> {p.usadoPor.tamaño}KB</div> : <div>Vacía</div>}
          </div>
        );
        return (
          <Tooltip key={p.id} title={tooltip} placement="right">
            <div style={{ height: `${pctContenedor}%` }} className="w-full border-b-2 border-slate-400 relative">
              {/* Relleno del proceso (proporcional dentro de la partición) */}
              {hayProceso ? (
                <div className="absolute left-0 top-0 w-full" style={{ height: `${pctUsado}%`, background: p.usadoPor.color }}>
                  <div className="h-full w-full flex items-center justify-center text-[10px] text-white/90">{p.usadoPor.nombre} ({p.usadoPor.tamaño}KB)</div>
                </div>
              ) : null}
              {/* Fragmentación interna */}
              <div className="absolute left-0 bottom-0 w-full" style={{ height: `${100 - pctUsado}%`, background: hayProceso? 'repeating-linear-gradient(45deg,#ffffff,#ffffff 6px,#ef4444 6px,#ef4444 12px)' : 'repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb 6px,#f3f4f6 6px,#f3f4f6 12px)' }} />
              {/* Etiqueta de la partición (borde superior visible) */}
              <div className="absolute inset-0 pointer-events-none flex items-start justify-center pt-1">
                <span className="text-[10px] bg-white/70 px-1 rounded">P{p.índice} ({p.tamaño}KB)</span>
              </div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function PanelEstadisticas({ e, modo }){
  return (
    <div className="flex-1 grid grid-cols-2 gap-3">
      <TarjetaEstadística etiqueta="Usada" valor={`${e.usada} KB`} />
      <TarjetaEstadística etiqueta="Libre" valor={`${e.libre} KB`} />
      {modo==='dinamicas' && <TarjetaEstadística etiqueta="Frag. Externa" valor={`${e.fragExterna} KB`} />}
      {modo==='fijas' && <TarjetaEstadística etiqueta="Frag. Interna" valor={`${e.fragInterna} KB`} />}
      {modo==='fijas' && <TarjetaEstadística etiqueta="Desperdicio particiones vacías" valor={`${e.desperdicioVacias} KB`} />}
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

function TablaProcesos({ titulo, filas, botonAccion, mostrarNota=false }){
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b text-sm font-medium">{titulo}</div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-left"><th className="px-2 py-1">Nombre</th><th className="px-2 py-1">Tamaño</th><th className="px-2 py-1">Acción</th></tr>
          </thead>
          <tbody>
            {filas.length===0 && <tr><td colSpan={3} className="px-2 py-2 text-slate-400">Vacío</td></tr>}
            {filas.map(p=> (
              <tr key={p.id} className={`hover:bg-slate-50`}>
                <td className="px-2 py-1">
                  {p.nombre}
                  {mostrarNota && p.nota && <span className="ml-1 text-[10px] text-slate-500">{p.nota}</span>}
                </td>
                <td className="px-2 py-1">{p.tamaño} KB</td>
                <td className="px-2 py-1">
                  {botonAccion && <Button size="small" color={botonAccion.color||'primary'} onClick={()=>botonAccion.onClick?.(p.id)}>{botonAccion.etiqueta||'Acción'}</Button>}
                </td>
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
            <div>Usada: {c.estadisticas.usada}KB · Libre: {c.estadisticas.libre}KB</div>
          </div>
        ))}
      </div>
    </div>
  );
}
