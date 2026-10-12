(() => {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const EMBEDDED_NAV = new URLSearchParams(location.search).get('embedded')==='1';
if(EMBEDDED_NAV) document.body.classList.add('embedded-nav');
const STORE = 'geofoto_nav_proto_annotations_v1';
const IMPORT_EDIT_STORE='geofoto_nav_proto_import_edits_v1';
const PROJECT_STORE='geofoto_nav_proto_projects_v1';
const PROJECT_ACTIVE_STORE='geofoto_nav_proto_project_active_v1';
const PROJECT_TS_STORE='geofoto_nav_proto_project_ts_v1';
const PROJECT_DB_NAME='geofoto_nav_proto_storage_v1';
const PROJECT_DB_OBJECT='state';
const NAV_RECENT_STORE='geofoto_nav_proto_recent_destinations_v1';
const NAV_VOICE_STORE='geofoto_nav_proto_voice_v1';
const map = L.map('map', {zoomControl:true, preferCanvas:true,maxZoom:22}).setView([-25.43,-49.27], 12);
map.createPane('kmlLinePane');map.getPane('kmlLinePane').style.zIndex='410';
map.createPane('kmlPointPane');map.getPane('kmlPointPane').style.zIndex='640';
map.createPane('editPane');map.getPane('editPane').style.zIndex='1000';map.getPane('editPane').style.pointerEvents='none';
map.createPane('projectPane');map.getPane('projectPane').style.zIndex='560';
const kmlCanvas = L.canvas({padding:.5,tolerance:7,pane:'kmlLinePane'});
const kmlPointCanvas = L.canvas({padding:.7,tolerance:14,pane:'kmlPointPane'});

const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom:22,maxNativeZoom:19,attribution:'&copy; OpenStreetMap'
});
const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom:22,maxNativeZoom:18,attribution:'Tiles &copy; Esri'
});
const labels = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
  maxZoom:22,maxNativeZoom:18,attribution:'Esri'
});
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom:22,maxNativeZoom:17,attribution:'&copy; OpenStreetMap contributors, SRTM | OpenTopoMap'
});
const hybrid = L.layerGroup([satellite, labels]);
const bases = {street, satellite, hybrid, topo};
let activeBase = satellite.addTo(map);
L.control.scale({imperial:false,metric:true,position:'bottomright',maxWidth:140}).addTo(map);

let documents = [];
let searchIndex = [];
let importedEdits=loadImportedEdits();
let selectedImported=null;
let importedGeometryTarget=null;
let importedPointMoveHandle=null;
let searchTimer = null;
let annotations = loadAnnotations();
let annotationLayers = new Map();
let projects=loadProjects();
let activeProjectId=loadActiveProjectId(projects);
let selectedProjectNodeId='';
const projectLayerGroup=L.layerGroup().addTo(map);
let projectLayerIndex=new Map();
let currentTool = null;
let tempPoints = [];
let tempLayer = null;
let tempVertexMarkers = [];
let pendingEdit = null;
let watchId = null;
let gpsMarker = null;
let gpsLatLng = null;
let gpsHeading = 0;
let followGps = false;
let driving = false;
let measuredTarget=null;
let measuredTargetMarker=null;
let measuredTargetLine=null;
let navigatingMeasuredTarget=false;
let measuredRouteCoords=null;
let measuredRouteDistance=null;
let measuredRouteDuration=null;
let measuredRouteLoading=false;
let measuredRouteLastFrom=null;
let measuredRouteLastAt=0;
let measuredRouteRetryAt=0;
let measuredRouteSteps=[];
let measuredRouteStepIndexes=[];
let measuredRouteStartSnap=null;
let measuredRouteEndSnap=null;
let measuredRouteConnector=null;
let measuredFinalApproachLine=null;
let measuredFinalApproachDistance=0;
let lastRouteProgressIndex=0;
let drivePickDestination=false;
let driveSearchTimer=null;
let driveSearchSeq=0;
let lastMeasuredTarget=null;
let recentDestinations=loadRecentDestinations();
let navVoiceEnabled=loadNavVoicePreference();
let navLastSpokenKey='';
let navWakeLock=null;
let lastGpsAccuracy=null;
let lastGpsSpeedKmh=0;
let focusHighlightLayer=null;
let focusHighlightTimer=null;
let lastMapCoord=null;
let coordFormat='dec';

function status(msg){ $('#statusBar').textContent = msg; }
function uid(prefix='id'){ return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }
function esc(v){ return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function stripHtml(v){
  const d=document.createElement('div'); d.innerHTML=String(v||''); return (d.textContent||'').trim();
}
function fmtDistance(m){
  if(!Number.isFinite(m)) return '0 m';
  return m>=1000 ? (m/1000).toLocaleString('pt-BR',{maximumFractionDigits:3})+' km'
                 : m.toLocaleString('pt-BR',{maximumFractionDigits:1})+' m';
}
function fmtMeasureDistance(m){
  const unit=$('#measureUnit')?.value||'auto';
  if(!Number.isFinite(m))m=0;
  if(unit==='m')return m.toLocaleString('pt-BR',{maximumFractionDigits:2})+' m';
  if(unit==='km')return (m/1000).toLocaleString('pt-BR',{maximumFractionDigits:4})+' km';
  if(unit==='ft')return (m*3.280839895).toLocaleString('pt-BR',{maximumFractionDigits:1})+' ft';
  if(unit==='mi')return (m/1609.344).toLocaleString('pt-BR',{maximumFractionDigits:4})+' mi';
  return fmtDistance(m);
}
function fmtArea(m2){
  if(!Number.isFinite(m2))m2=0;
  return m2>=1000000?(m2/1000000).toLocaleString('pt-BR',{maximumFractionDigits:3})+' km²':m2.toLocaleString('pt-BR',{maximumFractionDigits:1})+' m²';
}
function toDms(v,isLat){
  const a=Math.abs(v),d=Math.floor(a),mf=(a-d)*60,m=Math.floor(mf),s=(mf-m)*60;
  return d+'°'+m+"'"+s.toFixed(1)+'" '+(isLat?(v<0?'S':'N'):(v<0?'O':'L'));
}
async function copyText(text,msg='Copiado.'){
  try{await navigator.clipboard.writeText(text);status(msg)}catch{prompt('Copie o texto:',text)}
}

function hideMapContextMenu(){document.querySelector('#mapContextMenu')?.remove()}
function showMapContextMenu(latlng,containerPoint){
  hideMapContextMenu();
  const menu=document.createElement('div');menu.id='mapContextMenu';menu.className='map-context-menu';
  menu.style.left=Math.min(containerPoint.x,map.getSize().x-230)+'px';menu.style.top=Math.min(containerPoint.y,map.getSize().y-245)+'px';
  menu.innerHTML='<button data-a="marker">📍 Novo marcador aqui</button><button data-a="drive">🚗 Navegar até aqui</button><button data-a="copy">⧉ Copiar coordenadas</button><button data-a="maps">🗺 Abrir no Maps</button><button data-a="center">◎ Centralizar aqui</button>';
  map.getContainer().appendChild(menu);
  menu.querySelector('[data-a="marker"]').onclick=()=>{hideMapContextMenu();openEditModal('marker',[[latlng.lat,latlng.lng]])};
  menu.querySelector('[data-a="drive"]').onclick=()=>{hideMapContextMenu();setNavigationTarget(latlng.lat,latlng.lng,'Local escolhido no mapa','Mapa');startMeasuredNavigation()};
  menu.querySelector('[data-a="copy"]').onclick=()=>{hideMapContextMenu();copyText(latlng.lat.toFixed(6)+', '+latlng.lng.toFixed(6),'Coordenadas copiadas.')};
  menu.querySelector('[data-a="maps"]').onclick=()=>{hideMapContextMenu();window.open(mapsSearchLink(latlng.lat,latlng.lng),'_blank','noopener')};
  menu.querySelector('[data-a="center"]').onclick=()=>{hideMapContextMenu();map.panTo(latlng,{animate:true})};
}


function stopLeafletContext(e){
  try{if(e?.originalEvent){e.originalEvent._gfFeatureMenu=true;L.DomEvent.preventDefault(e.originalEvent);L.DomEvent.stopPropagation(e.originalEvent)}}catch{}
}
function buildFeatureMenu(containerPoint,title,actions){
  hideMapContextMenu();
  const menu=document.createElement('div');menu.id='mapContextMenu';menu.className='map-context-menu feature-menu';
  menu.style.left=Math.max(6,Math.min(containerPoint.x,map.getSize().x-244))+'px';
  menu.style.top=Math.max(6,Math.min(containerPoint.y,map.getSize().y-300))+'px';
  menu.innerHTML='<div class="context-title">'+esc(title||'Elemento selecionado')+'</div>';
  for(const a of actions){
    if(!a)continue;
    if(a.sep){const hr=document.createElement('div');hr.className='context-sep';menu.appendChild(hr);continue}
    const b=document.createElement('button');b.type='button';b.innerHTML=(a.icon?'<span class="context-ico">'+a.icon+'</span>':'')+'<span>'+esc(a.label)+'</span>';
    if(a.danger)b.classList.add('danger');
    b.onclick=()=>{hideMapContextMenu();a.run?.()};
    menu.appendChild(b);
  }
  map.getContainer().appendChild(menu);
}
function showImportedContextMenu(node,e){
  if(!node||currentTool)return;
  stopLeafletContext(e);
  const cp=e.containerPoint||map.latLngToContainerPoint(e.latlng),isPoint=!!node.pointLayer,isLine=!!node.lineParts?.length;
  const actions=[
    {icon:'⌕',label:'Ver informações',run:()=>focusImportedNode(node,true)},
    {icon:'✎',label:'Editar informações e estilo',run:()=>openImportedEdit(node)},
    isPoint?{icon:'✥',label:'Mover ponto',run:()=>startImportedPointMove(node)}:null,
    isLine?{icon:'⌁',label:'Editar traçado',run:()=>startImportedLineEdit(node)}:null,
    isPoint?{icon:'↗',label:'Navegar até aqui',run:()=>{const ll=node.pointLayer.getLatLng();setNavigationTarget(ll.lat,ll.lng,node.name||'Destino',node.source||'KMZ/KML');startMeasuredNavigation()}}:null,
    {sep:true},
    {icon:'＋',label:'Adicionar ao Projeto KMZ',run:()=>{selectedImported=node;document.querySelector('[data-tab="projects"]')?.click();addSelectedImportedToProject()}},
    isPoint?{icon:'⧉',label:'Copiar coordenadas',run:()=>{const ll=node.pointLayer.getLatLng();copyText(ll.lat.toFixed(6)+', '+ll.lng.toFixed(6),'Coordenadas copiadas.')}}:null
  ];
  buildFeatureMenu(cp,node.name||importedType(node),actions);
}
function showAnnotationContextMenu(a,layer,e){
  stopLeafletContext(e);
  const cp=e.containerPoint||map.latLngToContainerPoint(e.latlng),isPoint=a.type==='marker';
  const actions=[
    {icon:'⌕',label:'Centralizar neste item',run:()=>fitLayer(layer)},
    {icon:'✎',label:'Editar',run:()=>openEditModal(a.type,a.coords,a)},
    isPoint?{icon:'↗',label:'Navegar até aqui',run:()=>{const c=a.coords?.[0];if(c){setNavigationTarget(c[0],c[1],a.name||'Destino','Meus desenhos');startMeasuredNavigation()}}}:null,
    {icon:'＋',label:'Adicionar ao Projeto KMZ',run:()=>{const p=activeProject();if(!p){alert('Crie ou selecione um projeto em Projetos KMZ.');return}const folder=chooseProjectFolder();if(folder)addProjectItem(snapshotAnnotationForProject(a),folder)}},
    {sep:true},
    {icon:'×',label:'Excluir este item',danger:true,run:()=>{if(confirm('Excluir "'+a.name+'"?')){annotations=annotations.filter(x=>x.id!==a.id);saveAnnotations();renderAnnotations();status('Item excluído.')}}}
  ];
  buildFeatureMenu(cp,a.name||'Meu desenho',actions);
}
function showProjectContextMenu(item,e){
  stopLeafletContext(e);
  const cp=e.containerPoint||map.latLngToContainerPoint(e.latlng),isPoint=item.geometries?.[0]?.type==='Point';
  const actions=[
    {icon:'⌕',label:'Ver informações',run:()=>showProjectItemInfo(item)},
    {icon:'✎',label:'Editar',run:()=>openProjectItemEdit(item)},
    {icon:'◎',label:'Centralizar neste item',run:()=>fitProjectNode(item)},
    isPoint?{icon:'↗',label:'Navegar até aqui',run:()=>{const c=item.geometries?.[0]?.coords?.[0];if(c){setNavigationTarget(c[0],c[1],item.name||'Destino','Projeto KMZ');startMeasuredNavigation()}}}:null,
    {icon:'⧉',label:'Duplicar',run:()=>duplicateProjectNode(item)}
  ];
  buildFeatureMenu(cp,item.name||'Item do projeto',actions);
}

function updateCoordHud(latlng){
  if(!latlng)return;
  lastMapCoord=[latlng.lat,latlng.lng];
  const dec=latlng.lat.toFixed(6)+', '+latlng.lng.toFixed(6);
  const dms=toDms(latlng.lat,true)+' · '+toDms(latlng.lng,false);
  $('#coordHudText').textContent=coordFormat==='dec'?dec:dms;
  $('#coordHudText').title='Clique para alternar decimal / graus-minutos-segundos';
}
function mapsSearchLink(lat,lng){return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lat+','+lng)}
function streetViewLink(lat,lng){return 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint='+encodeURIComponent(lat+','+lng)}
async function fetchElevation(lat,lng){
  const u='/api/elevation?latitude='+encodeURIComponent(lat)+'&longitude='+encodeURIComponent(lng);
  const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error('elevação indisponível');
  const d=await r.json();const v=Array.isArray(d?.elevation)?Number(d.elevation[0]):Number(d?.elevation);
  if(!Number.isFinite(v))throw new Error('elevação indisponível');return v;
}
function sampleLine(coords,max=50){
  if(!Array.isArray(coords)||coords.length<2)return coords||[];
  const total=distanceOf(coords);if(total<=0)return coords.slice(0,1);
  const cumulative=[0];for(let i=1;i<coords.length;i++)cumulative.push(cumulative[i-1]+L.latLng(coords[i-1]).distanceTo(L.latLng(coords[i])));
  const out=[];for(let s=0;s<max;s++){
    const target=total*s/(max-1);let i=1;while(i<cumulative.length&&cumulative[i]<target)i++;
    if(i>=coords.length){out.push(coords[coords.length-1]);continue}
    const a=coords[i-1],b=coords[i],seg=cumulative[i]-cumulative[i-1]||1,t=(target-cumulative[i-1])/seg;
    out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
  }return out;
}
async function showElevationProfile(coords,name='Traçado'){
  if(!coords?.length)return;
  const panel=document.createElement('div');panel.className='elevation-panel';panel.innerHTML='<div class="elev-head"><div><span>PERFIL DE ELEVAÇÃO</span><h3>'+esc(name)+'</h3></div><button type="button">×</button></div><div class="elev-loading">Carregando elevação...</div>';document.querySelector('.map-wrap').appendChild(panel);panel.querySelector('button').onclick=()=>panel.remove();
  try{
    const pts=sampleLine(coords,50),lats=pts.map(p=>p[0].toFixed(6)).join(','),lngs=pts.map(p=>p[1].toFixed(6)).join(',');
    const r=await fetch('/api/elevation?latitude='+encodeURIComponent(lats)+'&longitude='+encodeURIComponent(lngs),{cache:'no-store'});
    if(!r.ok)throw new Error();const d=await r.json(),e=(d.elevation||[]).map(Number).filter(Number.isFinite);if(e.length<2)throw new Error();
    const min=Math.min(...e),max=Math.max(...e),range=Math.max(1,max-min),w=600,h=170,pad=18;
    const points=e.map((v,i)=>[(pad+(w-pad*2)*i/(e.length-1)),(h-pad-(h-pad*2)*(v-min)/range)]);
    const poly=points.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
    let ascent=0,descent=0;for(let i=1;i<e.length;i++){const dif=e[i]-e[i-1];if(dif>0)ascent+=dif;else descent+=Math.abs(dif)}
    panel.innerHTML='<div class="elev-head"><div><span>PERFIL DE ELEVAÇÃO</span><h3>'+esc(name)+'</h3></div><button type="button">×</button></div><div class="elev-stats"><b>Mín. '+min.toFixed(0)+' m</b><b>Máx. '+max.toFixed(0)+' m</b><b>Subida '+ascent.toFixed(0)+' m</b><b>Descida '+descent.toFixed(0)+' m</b><b>'+fmtDistance(distanceOf(coords))+'</b></div><svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none"><polyline points="'+poly+'" fill="none" stroke="currentColor" stroke-width="4"/><line x1="'+pad+'" y1="'+(h-pad)+'" x2="'+(w-pad)+'" y2="'+(h-pad)+'" stroke="currentColor" opacity=".3"/></svg>';
    panel.querySelector('button').onclick=()=>panel.remove();
  }catch{panel.querySelector('.elev-loading').textContent='Não foi possível obter o perfil de elevação agora.'}
}

function distanceOf(coords){
  let sum=0;
  for(let i=1;i<coords.length;i++) sum += L.latLng(coords[i-1]).distanceTo(L.latLng(coords[i]));
  return sum;
}
function areaOf(coords){
  if(coords.length<3) return 0;
  const R=6378137, pts=coords.map(c=>[c[0]*Math.PI/180,c[1]*Math.PI/180]);
  let area=0;
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    area += (b[1]-a[1])*(2+Math.sin(a[0])+Math.sin(b[0]));
  }
  return Math.abs(area*R*R/2);
}
function circlePolygon(center,radius,steps=72){
  const lat1=center[0]*Math.PI/180,lon1=center[1]*Math.PI/180,R=6378137,ang=radius/R,out=[];
  for(let i=0;i<steps;i++){
    const br=2*Math.PI*i/steps;
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(ang)+Math.cos(lat1)*Math.sin(ang)*Math.cos(br));
    const lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(ang)*Math.cos(lat1),Math.cos(ang)-Math.sin(lat1)*Math.sin(lat2));
    out.push([lat2*180/Math.PI,lon2*180/Math.PI]);
  }
  return out;
}

function fitLayer(layer){
  try{
    if(layer.getLatLng){
      const ll=layer.getLatLng();
      return map.flyTo(ll,19,{animate:true,duration:.55});
    }
    if(layer.getBounds){
      const b=layer.getBounds();
      if(b.isValid())return map.flyToBounds(b.pad(.08),{animate:true,duration:.65,maxZoom:18});
    }
  }catch{}
}
function clearFocusHighlight(){
  clearTimeout(focusHighlightTimer);
  if(focusHighlightLayer&&map.hasLayer(focusHighlightLayer))map.removeLayer(focusHighlightLayer);
  focusHighlightLayer=null;
}
function highlightImportedNode(node){
  clearFocusHighlight();
  try{
    if(node?.pointLayer){
      const ll=node.pointLayer.getLatLng();
      focusHighlightLayer=L.circleMarker(ll,{radius:15,color:'#00e5ff',weight:4,fill:false,opacity:1,interactive:false,pane:'editPane'}).addTo(map);
    }else if(node?.lineParts?.length){
      focusHighlightLayer=L.featureGroup(node.lineParts.map(p=>L.polyline(p.coords,{color:'#00e5ff',weight:8,opacity:.95,interactive:false,pane:'editPane'}))).addTo(map);
    }else if(node?.polygonParts?.length){
      focusHighlightLayer=L.featureGroup(node.polygonParts.map(p=>L.polygon(p.coords,{color:'#00e5ff',weight:6,fill:false,opacity:.95,interactive:false,pane:'editPane'}))).addTo(map);
    }
    if(focusHighlightLayer)focusHighlightTimer=setTimeout(clearFocusHighlight,2400);
  }catch{}
}
function focusImportedNode(node,openInfo=true){
  if(!node)return;
  selectedImported=node;
  node.visible=true;
  if(node.layer&&!map.hasLayer(node.layer))node.layer.addTo(map);
  applyImportedVisual(node);
  if(node.pointLayer){
    const ll=node.pointLayer.getLatLng();
    map.flyTo(ll,19,{animate:true,duration:.55});
  }else{
    try{
      const b=node.layer?.getBounds?.();
      if(b?.isValid?.())map.flyToBounds(b.pad(.08),{animate:true,duration:.7,maxZoom:18});
    }catch{}
  }
  highlightImportedNode(node);
  renderLayerTree();
  refreshPointLabels();
  if(openInfo)setTimeout(()=>showImportedFeature(node),220);
  status('Selecionado: '+(node.name||'item')+'.');
}
function focusImportedFolder(node){
  const b=nodeBounds(node);
  if(b?.isValid?.())map.flyToBounds(b.pad(.08),{animate:true,duration:.75,maxZoom:17});
  status('Camada: '+(node.name||'pasta')+'.');
}
function popupHtml(name,note,extra=''){
  return '<div class="popup-title">'+esc(name||'Sem nome')+'</div>'+
    (note?'<div class="popup-note">'+esc(stripHtml(note))+'</div>':'')+extra;
}

function kmlColor(v, fallback='#ff3b30'){
  v=String(v||'').trim().replace('#','');
  if(v.length===8) return {color:'#'+v.slice(6,8)+v.slice(4,6)+v.slice(2,4), opacity:parseInt(v.slice(0,2),16)/255};
  if(v.length===6) return {color:'#'+v,opacity:1};
  return {color:fallback,opacity:1};
}
function directChildren(node, tag){
  return [...node.children].filter(x=>x.localName===tag);
}
function textOf(node, tag){
  const x=directChildren(node,tag)[0]; return x ? x.textContent.trim() : '';
}
function parseCoords(txt){
  return String(txt||'').trim().split(/\s+/).map(s=>{
    const p=s.split(',').map(Number); return p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])?[p[1],p[0],p[2]||0]:null;
  }).filter(Boolean);
}
function readStyles(xml){
  const out={};
  xml.querySelectorAll('Style[id]').forEach(st=>{
    const id=st.getAttribute('id'), line=st.querySelector('LineStyle'), poly=st.querySelector('PolyStyle');
    const lc=kmlColor(line?.querySelector('color')?.textContent,'#ff3b30');
    const pc=kmlColor(poly?.querySelector('color')?.textContent,'#3b82f6');
    out['#'+id]={
      color:lc.color, opacity:lc.opacity,
      weight:Number(line?.querySelector('width')?.textContent)||3,
      fillColor:pc.color, fillOpacity:Math.min(pc.opacity,.35)
    };
  });
  xml.querySelectorAll('StyleMap[id]').forEach(sm=>{
    const id=sm.getAttribute('id');
    const pair=[...sm.querySelectorAll('Pair')].find(p=>p.querySelector('key')?.textContent.trim()==='normal') || sm.querySelector('Pair');
    const url=pair?.querySelector('styleUrl')?.textContent.trim();
    if(url&&out[url]) out['#'+id]=out[url];
  });
  return out;
}
function placemarkExtras(pm){
  const parts=[];
  pm.querySelectorAll('ExtendedData Data').forEach(d=>{
    const n=d.getAttribute('name'), v=d.querySelector('value')?.textContent?.trim();
    if(n&&v) parts.push(n+': '+v);
  });
  return parts.join('\n');
}
function makeGeometry(pm, styles){
  const name=textOf(pm,'name')||'Sem nome';
  const desc=[textOf(pm,'description'),placemarkExtras(pm)].filter(Boolean).join('\n');
  const style=styles[textOf(pm,'styleUrl')]||{color:'#ff3b30',opacity:1,weight:3,fillColor:'#3b82f6',fillOpacity:.22};
  const pieces=[];let pointLayer=null;const lineParts=[];const polygonParts=[];
  const point=pm.querySelector('Point coordinates');
  if(point){
    const c=parseCoords(point.textContent)[0];
    if(c){
      const layer=L.circleMarker([c[0],c[1]],{renderer:kmlPointCanvas,radius:7,color:'#ffffff',weight:2.5,fillColor:style.color||'#ffd54a',fillOpacity:1});
      layer.bindTooltip('<b>'+esc(name)+'</b>',{direction:'right',offset:[10,0],className:'kml-point-label',opacity:1});
      pointLayer=layer;pieces.push(layer);
    }
  }
  pm.querySelectorAll('LineString coordinates').forEach(x=>{
    const c=parseCoords(x.textContent).map(v=>[v[0],v[1]]);
    if(c.length>1){
      const layer=L.polyline(c,{renderer:kmlCanvas,color:style.color,opacity:style.opacity,weight:style.weight});
      // Detalhes completos são exibidos somente no painel ao clicar no traçado.
      layer._gfKind='line';lineParts.push({layer,coords:c});pieces.push(layer);
    }
  });
  pm.querySelectorAll('Polygon').forEach(poly=>{
    const outer=poly.querySelector('outerBoundaryIs coordinates');
    const c=parseCoords(outer?.textContent||'').map(v=>[v[0],v[1]]);
    if(c.length>2){
      const layer=L.polygon(c,{renderer:kmlCanvas,color:style.color,opacity:style.opacity,weight:style.weight,fillColor:style.fillColor,fillOpacity:style.fillOpacity});
      // Detalhes completos são exibidos somente no painel ao clicar na área.
      layer._gfKind='polygon';polygonParts.push({layer,coords:c});pieces.push(layer);
    }
  });
  if(!pieces.length) return null;
  const layer=pieces.length===1?pieces[0]:L.featureGroup(pieces);
  return {type:'placemark',id:uid('k'),name,note:desc,visible:true,layer,isPoint:!!pointLayer,pointLayer,lineParts,polygonParts,originalName:name,originalNote:desc,style:{...style}};
}

function parseContainer(el, styles, fallbackName){
  const node={type:'folder',id:uid('f'),name:textOf(el,'name')||fallbackName||'Pasta',visible:true,expanded:false,children:[]};
  [...el.children].forEach(ch=>{
    if(ch.localName==='Folder'||ch.localName==='Document'){
      node.children.push(parseContainer(ch,styles,ch.localName==='Document'?'Documento':'Pasta'));
    }else if(ch.localName==='Placemark'){
      const p=makeGeometry(ch,styles); if(p) node.children.push(p);
    }
  });
  return node;
}
function allPlacemarks(node,out=[]){
  if(node.type==='placemark') out.push(node);
  (node.children||[]).forEach(x=>allPlacemarks(x,out));
  return out;
}
function setNodeVisible(node,visible){
  node.visible=visible;
  if(node.type==='placemark'){
    if(visible){
      if(!map.hasLayer(node.layer)) node.layer.addTo(map);
      applyImportedVisual(node);
    }else{
      if(map.hasLayer(node.layer)) map.removeLayer(node.layer);
      if(node.pointIconLayer&&map.hasLayer(node.pointIconLayer))map.removeLayer(node.pointIconLayer);
    }
  }
  (node.children||[]).forEach(x=>setNodeVisible(x,visible));
}
function removeNodeLayers(node){
  if(node.type==='placemark'&&map.hasLayer(node.layer)) map.removeLayer(node.layer);
  if(node.pointIconLayer&&map.hasLayer(node.pointIconLayer))map.removeLayer(node.pointIconLayer);
  (node.children||[]).forEach(removeNodeLayers);
}
function setDocumentOpacity(doc,value){
  const op=Math.max(.05,Math.min(1,Number(value)||1));doc.opacity=op;
  for(const node of allPlacemarks(doc.root)){node._docOpacity=op;applyImportedVisual(node)}
  status(doc.name+' · opacidade '+Math.round(op*100)+'%.');
}
function nodeBounds(node){
  let bounds=null;
  try{
    for(const p of allPlacemarks(node)){
      const l=p.layer;
      let b=null;
      if(l?.getBounds)b=l.getBounds();
      else if(l?.getLatLng){const ll=l.getLatLng();b=L.latLngBounds(ll,ll)}
      if(b?.isValid?.())bounds=bounds?bounds.extend(b):L.latLngBounds(b);
    }
    return bounds?.isValid?.()?bounds:null;
  }catch{return null}
}
function normalizeSearch(v){
  return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim();
}
function indexDocument(doc){
  let seq=0;
  const walk=(node,path=[],parent=null)=>{
    node._parent=parent;node._docId=doc.id;
    const pathNow=node.type==='folder'?[...path,node.name]:path;
    if(node.type==='placemark'){
      node.source=doc.name;node.path=path.join(' › ');node._docOpacity=doc.opacity??1;
      node.editKey=normalizeSearch(doc.name)+'::'+normalizeSearch(node.path)+'::'+normalizeSearch(node.originalName||node.name)+'::'+(seq++);
      if(node.pointLayer&&!node._originalPoint){const ll=node.pointLayer.getLatLng();node._originalPoint=[ll.lat,ll.lng]}
      if(node.lineParts?.[0]&&!node._originalLine)node._originalLine=node.lineParts[0].coords.map(c=>[...c]);
      applyImportedEdit(node,importedEdits[node.editKey]);
      bindImportedInteraction(node);
    }
    const label=[node.name,node.note||'',path.join(' '),doc.name].join(' ');
    searchIndex.push({docId:doc.id,source:doc.name,node,path:path.join(' › '),key:normalizeSearch(label)});
    (node.children||[]).forEach(ch=>walk(ch,pathNow,node));
  };
  walk(doc.root,[],null);
}
function removeDocumentFromIndex(docId){searchIndex=searchIndex.filter(x=>x.docId!==docId)}
async function addDocumentToMap(doc){
  const items=allPlacemarks(doc.root),chunk=300;
  for(let i=0;i<items.length;i+=chunk){
    const end=Math.min(i+chunk,items.length);
    for(let j=i;j<end;j++){const p=items[j];p.visible=true;if(!map.hasLayer(p.layer))p.layer.addTo(map);applyImportedVisual(p)}
    status(doc.name+' · exibindo '+end.toLocaleString('pt-BR')+' de '+items.length.toLocaleString('pt-BR')+' elementos...');
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
  }
}
function refreshPointLabels(){
  clearTimeout(refreshPointLabels._timer);
  refreshPointLabels._timer=setTimeout(()=>{
    const show=map.getZoom()>=15,bounds=map.getBounds().pad(.08),maxLabels=220;
    let opened=0;
    for(const item of searchIndex){
      const node=item.node,layer=node?.pointLayer;
      if(!node?.isPoint||!layer)continue;
      const visible=map.hasLayer(layer);
      const inView=visible&&bounds.contains(layer.getLatLng());
      if(show&&inView&&opened<maxLabels){
        layer.openTooltip();layer.bringToFront?.();opened++;
      }else layer.closeTooltip();
    }
  },70);
}
function renderSearchResults(){
  const box=$('#searchResults'),raw=$('#searchInput').value,q=normalizeSearch(raw);
  if(!q){box.classList.add('hidden');box.innerHTML='';return}
  const coordMatch=String(raw).trim().match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if(coordMatch){
    const lat=Number(coordMatch[1].replace(',','.')),lng=Number(coordMatch[2].replace(',','.'));
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180){
      box.classList.remove('hidden');
      box.innerHTML='<div class="search-summary">Coordenadas</div><button class="search-result" id="goSearchCoord" type="button"><b>'+lat.toFixed(6)+', '+lng.toFixed(6)+'</b><span>Ir para estas coordenadas</span><small>'+esc(toDms(lat,true)+' · '+toDms(lng,false))+'</small></button>';
      $('#goSearchCoord').onclick=()=>{map.setView([lat,lng],18,{animate:true});updateCoordHud(L.latLng(lat,lng));status('Mapa centralizado nas coordenadas informadas.')};
      return;
    }
  }
  if(!documents.length){box.classList.remove('hidden');box.innerHTML='<div class="search-empty">Adicione um KMZ/KML para pesquisar.</div>';return}
  const terms=q.split(' ').filter(Boolean);
  const matches=[];
  for(const item of searchIndex){
    if(terms.every(t=>item.key.includes(t))){matches.push(item);if(matches.length>=80)break}
  }
  box.classList.remove('hidden');
  if(!matches.length){box.innerHTML='<div class="search-empty">Nenhum resultado para <b>'+esc(raw)+'</b>.</div>';return}
  box.innerHTML='<div class="search-summary">'+matches.length+(matches.length===80?'+':'')+' resultado(s)</div>'+
    matches.map((m,i)=>'<button class="search-result" type="button" data-search-result="'+i+'"><b>'+esc(m.node.name||'Sem nome')+'</b><span>'+esc(m.source)+'</span><small>'+esc(m.path|| (m.node.type==='folder'?'Pasta':'Elemento'))+'</small></button>').join('');
  box.querySelectorAll('[data-search-result]').forEach(b=>b.onclick=()=>{
    const m=matches[Number(b.dataset.searchResult)],node=m.node;
    if(node.type==='placemark'){
      focusImportedNode(node,true);
    }else{
      focusImportedFolder(node);
    }
    status('Encontrado em '+m.source+': '+node.name);
  });
}

function repairKmlNamespaces(text){
  const rootMatch=String(text||'').match(/<kml\b[^>]*>/i);
  if(!rootMatch)return text;
  let root=rootMatch[0];
  const used=[...new Set([...String(text).matchAll(/<\/?([A-Za-z_][\w.-]*):/g)].map(m=>m[1]))];
  const declared=[...new Set([...root.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=/g)].map(m=>m[1]))];
  const missing=used.filter(p=>!declared.includes(p)&&p!=='xml');
  if(!missing.length)return text;
  const attrs=missing.map(p=>' xmlns:'+p+'="urn:geofoto:'+p+'"').join('');
  const repaired=root.replace(/>$/i,attrs+'>');
  return String(text).replace(root,repaired);
}
async function readKmlFile(file){
  let text='';
  if(file.name.toLowerCase().endsWith('.kmz')){
    const zip=await JSZip.loadAsync(await file.arrayBuffer());
    const kmlNames=Object.keys(zip.files).filter(n=>n.toLowerCase().endsWith('.kml'));
    const chosen=kmlNames.find(n=>/doc\.kml$/i.test(n))||kmlNames[0];
    if(!chosen) throw new Error('Nenhum KML encontrado dentro do KMZ.');
    text=await zip.file(chosen).async('text');
  }else text=await file.text();
  text=repairKmlNamespaces(text);
  const xml=new DOMParser().parseFromString(text,'text/xml');
  if(xml.querySelector('parsererror')) throw new Error('KML inválido ou não reconhecido.');
  const styles=readStyles(xml);
  const rootEl=xml.querySelector('kml > Document, kml > Folder')||xml.documentElement;
  const root=parseContainer(rootEl,styles,file.name);
  root.name=file.name;root.expanded=false;
  return {id:uid('doc'),name:file.name,root,count:allPlacemarks(root).length};
}
async function loadFiles(files){
  for(const file of files){
    status('Lendo '+file.name+'...');
    try{
      const doc=await readKmlFile(file);
      documents.push(doc);
      indexDocument(doc);
      renderLayerTree();
      const b=nodeBounds(doc.root); if(b) map.fitBounds(b.pad(.08));
      await addDocumentToMap(doc);
      const total=doc.count||0;
      status(file.name+' carregado com '+total.toLocaleString('pt-BR')+' elementos.');
    }catch(e){ alert('Erro em '+file.name+': '+e.message); }
  }
  renderLayerTree();
  renderSearchResults();
  refreshPointLabels();
}

function renderLayerTree(){
  const tree=$('#layerTree'), q='';
  let total=0;
  tree.innerHTML='';
  if(!documents.length){ tree.className='tree empty'; tree.textContent='Nenhum KMZ/KML carregado.'; $('#layerCount').textContent='0 itens'; return; }
  tree.className='tree';
  const appendNode=(node,parent,depth=0)=>{
    if(node.type==='placemark'&&q&&!node.name.toLocaleLowerCase('pt-BR').includes(q)&&!String(node.note||'').toLocaleLowerCase('pt-BR').includes(q)) return false;
    if(node.type==='folder'&&q){
      const matches=(node.children||[]).some(x=>x.type==='placemark'
        ? x.name.toLocaleLowerCase('pt-BR').includes(q)||String(x.note||'').toLocaleLowerCase('pt-BR').includes(q)
        : hasMatch(x,q));
      if(!matches&&!node.name.toLocaleLowerCase('pt-BR').includes(q)) return false;
    }
    const wrap=document.createElement('div'); wrap.className='tree-node';
    const row=document.createElement('div'); row.className='tree-row'+(node===selectedImported?' tree-selected':''); row.dataset.nodeId=node.id; row.style.paddingLeft=(6+depth*13)+'px';
    const exp=document.createElement('button'); exp.className='tree-exp';
    exp.textContent=node.type==='folder'?(node.expanded?'▾':'▸'):'';
    row.appendChild(exp);
    const cb=document.createElement('input'); cb.type='checkbox'; cb.className='tree-check'; cb.checked=node.visible!==false;
    row.appendChild(cb);
    const label=document.createElement('span'); label.className='tree-label'+(node.type==='folder'?' folder':''); label.textContent=node.name;
    row.appendChild(label);
    if(node.type==='placemark'){
      const meta=document.createElement('span');meta.className='tree-meta';meta.textContent='●';row.appendChild(meta);total++;
      const actions=document.createElement('div');actions.className='tree-actions tree-item-actions';
      actions.innerHTML='<button class="mini info" type="button" title="Ver informações">Info</button><button class="mini project" type="button" title="Adicionar ao projeto KMZ">Projeto</button><button class="mini edit" type="button" title="Editar informações">Editar</button>';
      row.appendChild(actions);
      actions.querySelector('.info').onclick=e=>{e.stopPropagation();focusImportedNode(node,true)};
      actions.querySelector('.project').onclick=e=>{e.stopPropagation();selectedImported=node;document.querySelector('[data-tab="projects"]')?.click();addSelectedImportedToProject()};
      actions.querySelector('.edit').onclick=e=>{e.stopPropagation();selectedImported=node;renderLayerTree();openImportedEdit(node)};
    }else if(node.type==='folder'){
      const actions=document.createElement('div');actions.className='tree-actions tree-item-actions';
      actions.innerHTML='<button class="mini project" type="button" title="Copiar esta pasta inteira para um Projeto KMZ">Projeto</button>';
      row.appendChild(actions);
      actions.querySelector('.project').onclick=e=>{e.stopPropagation();document.querySelector('[data-tab="projects"]')?.click();addImportedTreeToProject(node)};
    }
    wrap.appendChild(row); parent.appendChild(wrap);
    cb.onchange=()=>{setNodeVisible(node,cb.checked);renderLayerTree();refreshPointLabels()};
    label.onclick=e=>{e.stopPropagation();if(node.type==='placemark')focusImportedNode(node,true);else focusImportedFolder(node)};
    row.onclick=e=>{if(e.target.closest('button,input'))return;if(node.type==='placemark')focusImportedNode(node,true);else focusImportedFolder(node)};
    exp.onclick=()=>{if(node.type==='folder'){node.expanded=!node.expanded;renderLayerTree()}};
    if(node.type==='folder'&&node.expanded){
      (node.children||[]).forEach(x=>appendNode(x,wrap,depth+1));
    }
    return true;
  };
  const hasMatch=(node,term)=>{
    if(node.name?.toLocaleLowerCase('pt-BR').includes(term)) return true;
    return (node.children||[]).some(x=>hasMatch(x,term)||String(x.note||'').toLocaleLowerCase('pt-BR').includes(term));
  };
  documents.forEach(doc=>{
    const box=document.createElement('div');box.className='tree-node';
    const head=document.createElement('div');head.className='tree-row';head.dataset.nodeId=doc.root.id;
    head.innerHTML='<button class="tree-exp">'+(doc.root.expanded?'▾':'▸')+'</button><input class="tree-check" type="checkbox" '+(doc.root.visible!==false?'checked':'')+'><span class="tree-label folder">'+esc(doc.name)+'</span><div class="tree-actions"><button class="mini project">Projeto</button><button class="mini opacity">Opac.</button><button class="mini delete">Excluir</button></div>';
    box.appendChild(head);tree.appendChild(box);
    head.querySelector('.tree-exp').onclick=()=>{doc.root.expanded=!doc.root.expanded;renderLayerTree()};
    head.querySelector('.tree-check').onchange=e=>{setNodeVisible(doc.root,e.target.checked);renderLayerTree();refreshPointLabels()};
    head.querySelector('.tree-label').onclick=e=>{e.stopPropagation();focusImportedFolder(doc.root)};
    head.onclick=e=>{if(e.target.closest('button,input'))return;focusImportedFolder(doc.root)};
    head.querySelector('.project').onclick=e=>{e.stopPropagation();document.querySelector('[data-tab="projects"]')?.click();addImportedTreeToProject(doc.root)};
    head.querySelector('.opacity').onclick=e=>{e.stopPropagation();const raw=prompt('Opacidade de "'+doc.name+'" (5 a 100%):',String(Math.round((doc.opacity??1)*100)));if(raw===null)return;const v=Math.max(5,Math.min(100,Number(raw)||100));setDocumentOpacity(doc,v/100)};
    head.querySelector('.delete').onclick=()=>{if(confirm('Excluir "'+doc.name+'" da biblioteca carregada da Navegação?\n\nO arquivo original do seu computador NÃO será apagado.')){removeNodeLayers(doc.root);documents=documents.filter(x=>x!==doc);removeDocumentFromIndex(doc.id);renderLayerTree();renderSearchResults();status(doc.name+' removido da biblioteca carregada.')}};
    if(doc.root.expanded)(doc.root.children||[]).forEach(x=>appendNode(x,box,1));
  });
  $('#layerCount').textContent=documents.reduce((n,d)=>n+Number(d.count||0),0).toLocaleString('pt-BR')+' itens';
}

function loadImportedEdits(){
  try{return JSON.parse(localStorage.getItem(IMPORT_EDIT_STORE)||'{}')}catch{return {}}
}
function saveImportedEdits(){localStorage.setItem(IMPORT_EDIT_STORE,JSON.stringify(importedEdits))}
function updateImportedSearch(node){
  for(const item of searchIndex){
    if(item.node===node)item.key=normalizeSearch([node.name,node.note||'',item.path,item.source].join(' '));
  }
  renderSearchResults();
}
function applyImportedVisual(node){
  const color=node.editColor||node.style?.color||'#ff3b30',weight=Number(node.editWeight||node.style?.weight||3),opacity=Number(node.editOpacity??node.style?.opacity??1)*(node._docOpacity??1);
  node.lineParts?.forEach(p=>p.layer.setStyle({color,weight,opacity}));
  node.polygonParts?.forEach(p=>p.layer.setStyle({color,weight,opacity,fillColor:color,fillOpacity:Math.min(.45,opacity*.35)}));
  if(node.pointLayer){
    const custom=node.editIcon&&node.editIcon!=='original';
    if(custom){
      node.pointLayer.setStyle({fillOpacity:0,opacity:0});
      const ll=node.pointLayer.getLatLng(),cfg={color,icon:node.editIcon,scale:node.editScale||1,opacity};
      if(!node.pointIconLayer){
        node.pointIconLayer=L.marker(ll,{icon:markerIcon(cfg),zIndexOffset:2200});
        node.pointIconLayer.on('click',e=>{if(currentTool)return;L.DomEvent.stopPropagation(e);showImportedFeature(node)});
        node.pointIconLayer.on('dblclick',e=>{if(currentTool)return;L.DomEvent.stopPropagation(e);openImportedEdit(node)});
        node.pointIconLayer.on('contextmenu',e=>showImportedContextMenu(node,e));
      }else{node.pointIconLayer.setLatLng(ll);node.pointIconLayer.setIcon(markerIcon(cfg))}
      if(node.visible!==false&&map.hasLayer(node.pointLayer)&&!map.hasLayer(node.pointIconLayer))node.pointIconLayer.addTo(map);
    }else{
      if(node.pointIconLayer&&map.hasLayer(node.pointIconLayer))map.removeLayer(node.pointIconLayer);
      node.pointLayer.setStyle({fillColor:color,color:'#fff',weight:2.5,fillOpacity:opacity,opacity});
    }
  }
  node.layer.unbindPopup?.();
  node.lineParts?.forEach(p=>p.layer.unbindPopup?.());
  node.polygonParts?.forEach(p=>p.layer.unbindPopup?.());
  if(node.pointLayer){
    node.pointLayer.unbindPopup?.();
    node.pointLayer.bindTooltip('<b>'+esc(node.name)+'</b>',{direction:'right',offset:[10,0],className:'kml-point-label',opacity:1});
  }
}
function applyImportedEdit(node,edit){
  if(!node||!edit)return;
  node.name=edit.name||node.name;
  node.note=edit.note??node.note;
  node.editColor=edit.color||node.editColor;
  if(edit.icon)node.editIcon=edit.icon;
  if(Number.isFinite(Number(edit.scale)))node.editScale=Number(edit.scale);
  if(Number.isFinite(Number(edit.weight)))node.editWeight=Number(edit.weight);
  if(Number.isFinite(Number(edit.opacity)))node.editOpacity=Number(edit.opacity);
  if(edit.pointCoord&&node.pointLayer)node.pointLayer.setLatLng(edit.pointCoord);
  if(edit.lineCoords&&node.lineParts?.[0]){
    node.lineParts[0].coords=edit.lineCoords.map(c=>[Number(c[0]),Number(c[1])]);
    node.lineParts[0].layer.setLatLngs(node.lineParts[0].coords);
  }
  applyImportedVisual(node);
}
function persistImportedEdit(node,patch={}){
  const prev=importedEdits[node.editKey]||{};
  const next={...prev,...patch,name:node.name,note:node.note,color:node.editColor||node.style?.color||'#ff3b30',icon:node.editIcon||'original',scale:node.editScale||1,weight:node.editWeight||node.style?.weight||3,opacity:node.editOpacity??node.style?.opacity??1};
  importedEdits[node.editKey]=next;saveImportedEdits();updateImportedSearch(node);
}
function bindImportedInteraction(node){
  if(node._bound)return;node._bound=true;
  const layers=[node.pointLayer,...(node.lineParts||[]).map(x=>x.layer),...(node.polygonParts||[]).map(x=>x.layer)].filter(Boolean);
  layers.forEach(layer=>{
    layer.on('click',e=>{if(currentTool)return;L.DomEvent.stopPropagation(e);showImportedFeature(node)});
    layer.on('dblclick',e=>{if(currentTool)return;L.DomEvent.stopPropagation(e);openImportedEdit(node)});
    layer.on('contextmenu',e=>showImportedContextMenu(node,e));
  });
}
function importedType(node){
  if(node.isPoint)return 'Ponto';
  if(node.lineParts?.length)return 'Traçado';
  if(node.polygonParts?.length)return 'Área';
  return 'Elemento';
}



function revealImportedInTree(node){
  if(!node)return;
  let p=node._parent;
  while(p){if(p.type==='folder')p.expanded=true;p=p._parent}
  const doc=documents.find(d=>d.id===node._docId);
  if(doc?.root)doc.root.expanded=true;
  if(!isMobileUi()){
    document.querySelector('.layout')?.classList.remove('sidebar-hidden');
    const layersTab=document.querySelector('[data-tab="layers"]');if(layersTab&&!layersTab.classList.contains('active'))layersTab.click();
  }
  renderLayerTree();
  requestAnimationFrame(()=>{
    const row=[...document.querySelectorAll('#layerTree .tree-row')].find(x=>x.dataset.nodeId===node.id);
    if(!row)return;
    document.querySelectorAll('#layerTree .tree-row.tree-selected').forEach(x=>x.classList.remove('tree-selected'));
    row.classList.add('tree-selected');
    row.scrollIntoView({behavior:'smooth',block:'center'});
  });
}

function ensureImportedPanel(){
  let panel=$('#importedFeaturePanel');
  if(panel)return panel;
  panel=document.createElement('div');panel.id='importedFeaturePanel';panel.className='imported-feature-panel hidden';
  document.querySelector('.map-wrap').appendChild(panel);
  return panel;
}
function closeImportedPanel(){
  const panel=$('#importedFeaturePanel');if(panel)panel.classList.add('hidden');
  selectedImported=null;
  if(importedPointMoveHandle&&map.hasLayer(importedPointMoveHandle))map.removeLayer(importedPointMoveHandle);
  importedPointMoveHandle=null;
}
function showImportedFeature(node){
  if(currentTool){status('Finalize ou cancele a ferramenta atual antes de abrir elementos do KMZ.');return}
  if(!node)return;
  if(isMobileUi())closeMobileSheet();
  selectedImported=node;revealImportedInTree(node);
  const panel=ensureImportedPanel(),type=importedType(node);
  const dist=node.lineParts?.length?'<div class="imported-detail-row"><span>Comprimento</span><b>'+fmtDistance(distanceOf(node.lineParts[0].coords))+'</b></div>':'';
  let pointInfo='',pointActions='';
  if(node.isPoint&&node.pointLayer){
    const ll=node.pointLayer.getLatLng();
    pointInfo='<div class="imported-detail-row"><span>Coordenadas</span><b>'+ll.lat.toFixed(6)+', '+ll.lng.toFixed(6)+'</b><small>'+esc(toDms(ll.lat,true)+' · '+toDms(ll.lng,false))+'</small><div id="pointElevation" class="point-elevation">Elevação: --</div></div>';
    pointActions='<button class="btn primary" id="navigateImportedPoint">🚗 Navegar até aqui</button><button class="btn secondary" id="copyImportedCoords">Copiar coordenadas</button><button class="btn secondary" id="openImportedMaps">Abrir no Maps</button><button class="btn secondary" id="openImportedStreet">Street View</button><button class="btn secondary" id="loadPointElevation">Ver elevação</button>';
  }
  panel.innerHTML='<div class="imported-head"><div><span>'+esc(type.toUpperCase())+'</span><h3>'+esc(node.name)+'</h3></div><button id="closeImportedPanel" type="button">×</button></div>'+
    '<div class="imported-source"><b>Arquivo:</b> '+esc(node.source||'KMZ/KML')+'</div>'+
    (node.path?'<div class="imported-path">'+esc(node.path)+'</div>':'')+
    '<div class="imported-detail-row"><span>Informações</span><p>'+(node.note?esc(stripHtml(node.note)):'Sem observação cadastrada.')+'</p></div>'+pointInfo+dist+
    '<div class="imported-actions"><button class="btn primary" id="editImportedInfo">Editar informações</button><button class="btn secondary" id="addImportedToProject">＋ Projeto KMZ</button>'+pointActions+
    (node.isPoint?'<button class="btn secondary" id="moveImportedPoint">Mover ponto</button>':'')+
    (node.lineParts?.length?'<button class="btn secondary" id="editImportedGeometry">Editar traçado</button><button class="btn secondary" id="showElevationProfile">Perfil de elevação</button>':'')+
    '<button class="btn secondary" id="restoreImported">Restaurar original</button></div>'+
    '<small class="imported-safe-note">As alterações ficam salvas no módulo Navegação. O arquivo KMZ original não é sobrescrito automaticamente.</small>';
  panel.classList.remove('hidden');
  panel.querySelector('#closeImportedPanel').onclick=closeImportedPanel;
  panel.querySelector('#editImportedInfo').onclick=()=>openImportedEdit(node);
  panel.querySelector('#addImportedToProject').onclick=()=>{selectedImported=node;document.querySelector('[data-tab="projects"]')?.click();addSelectedImportedToProject()};
  panel.querySelector('#moveImportedPoint')?.addEventListener('click',()=>startImportedPointMove(node));
  panel.querySelector('#editImportedGeometry')?.addEventListener('click',()=>startImportedLineEdit(node));
  panel.querySelector('#showElevationProfile')?.addEventListener('click',()=>showElevationProfile(node.lineParts[0].coords,node.name));
  if(node.isPoint&&node.pointLayer){
    const ll=node.pointLayer.getLatLng();
    panel.querySelector('#navigateImportedPoint').onclick=()=>{setNavigationTarget(ll.lat,ll.lng,node.name||'Ponto do KMZ',node.source||'KMZ/KML');closeImportedPanel();startMeasuredNavigation()};
    panel.querySelector('#copyImportedCoords').onclick=()=>copyText(ll.lat.toFixed(6)+', '+ll.lng.toFixed(6),'Coordenadas copiadas.');
    panel.querySelector('#openImportedMaps').onclick=()=>window.open(mapsSearchLink(ll.lat,ll.lng),'_blank','noopener');
    panel.querySelector('#openImportedStreet').onclick=()=>window.open(streetViewLink(ll.lat,ll.lng),'_blank','noopener');
    panel.querySelector('#loadPointElevation').onclick=async()=>{const el=panel.querySelector('#pointElevation');el.textContent='Elevação: carregando...';try{const h=await fetchElevation(ll.lat,ll.lng);el.textContent='Elevação aproximada: '+h.toFixed(0)+' m'}catch{el.textContent='Elevação indisponível agora.'}};
  }
  panel.querySelector('#restoreImported').onclick=()=>restoreImportedOriginal(node);
}
function showImportedChoices(items){
  const panel=ensureImportedPanel();selectedImported=null;
  panel.innerHTML='<div class="imported-head"><div><span>ELEMENTOS NESTE LOCAL</span><h3>Escolha o item</h3></div><button id="closeImportedPanel" type="button">×</button></div>'+
    '<div class="imported-choice-list">'+items.slice(0,12).map((x,i)=>'<button type="button" data-choice="'+i+'"><b>'+esc(x.node.name)+'</b><span>'+esc(importedType(x.node))+' · '+esc(x.node.source||'KMZ')+'</span></button>').join('')+'</div>';
  panel.classList.remove('hidden');
  panel.querySelector('#closeImportedPanel').onclick=closeImportedPanel;
  panel.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>showImportedFeature(items[Number(b.dataset.choice)].node));
}
function pointSegDistance(p,a,b){
  const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,c1=vx*wx+vy*wy;
  if(c1<=0)return p.distanceTo(a);
  const c2=vx*vx+vy*vy;if(c2<=c1)return p.distanceTo(b);
  const t=c1/c2,proj=L.point(a.x+t*vx,a.y+t*vy);return p.distanceTo(proj);
}
function findImportedAt(latlng){
  const click=map.latLngToContainerPoint(latlng),hits=[],bounds=map.getBounds().pad(.03);
  for(const item of searchIndex){
    const node=item.node;if(node?.type!=='placemark'||node.visible===false)continue;
    if(node.pointLayer&&map.hasLayer(node.pointLayer)){
      const ll=node.pointLayer.getLatLng();if(bounds.contains(ll)){
        const d=click.distanceTo(map.latLngToContainerPoint(ll));
        if(d<=22)hits.push({node,d:d-5});
      }
    }
    for(const part of node.lineParts||[]){
      if(!map.hasLayer(part.layer)||!part.layer.getBounds().pad(.03).contains(latlng))continue;
      let best=Infinity;
      const coords=part.coords;
      for(let i=1;i<coords.length;i++){
        const a=map.latLngToContainerPoint(coords[i-1]),b=map.latLngToContainerPoint(coords[i]);
        const d=pointSegDistance(click,a,b);if(d<best)best=d;if(best<=4)break;
      }
      if(best<=18)hits.push({node,d:best});
    }
  }
  const unique=new Map();
  hits.sort((a,b)=>a.d-b.d).forEach(h=>{if(!unique.has(h.node.id))unique.set(h.node.id,h)});
  return [...unique.values()].slice(0,12);
}
function openImportedEdit(node){
  if(currentTool){status('Finalize ou cancele a ferramenta atual antes de editar um elemento do KMZ.');return}
  pendingEdit={imported:node};
  $('#modalTitle').textContent='Editar '+importedType(node).toLowerCase()+' do KMZ';
  $('#editName').value=node.name||'';
  $('#editNote').value=stripHtml(node.note||'');
  $('#editColorLine').value=node.editColor||node.style?.color||'#ff3b30';
  $('#editLineWidth').value=String(node.editWeight||node.style?.weight||4);
  $('#editLineOpacity').value=String(Math.round(Number(node.editOpacity??node.style?.opacity??1)*100));
  $('#lineWidthValue').textContent=$('#editLineWidth').value+' px';
  $('#lineOpacityValue').textContent=$('#editLineOpacity').value+'%';
  $('#markerStylePanel').classList.toggle('hidden',!node.isPoint);
  $('#lineStylePanel').classList.toggle('hidden',node.isPoint);
  $('#markerPositionFields').classList.toggle('hidden',!node.isPoint);
  if(node.isPoint){
    const ll=node.pointLayer.getLatLng();$('#editLat').value=ll.lat.toFixed(7);$('#editLng').value=ll.lng.toFixed(7);
    $('#editColor').value=node.editColor||node.style?.color||'#ff3b30';
    $('#editIcon').value=node.editIcon||'original';
    $('#editScale').value=String(node.editScale||1);
    $('#editOpacity').value=String(Math.round(Number(node.editOpacity??node.style?.opacity??1)*100));
    refreshIconPalette();
  }
  $('#modal').classList.remove('hidden');setTimeout(()=>$('#editName').focus(),50);
}
function saveImportedFromModal(node){
  node.name=$('#editName').value.trim()||node.originalName||'Sem nome';
  node.note=$('#editNote').value.trim();
  if(node.isPoint){
    node.editColor=$('#editColor').value;
    node.editIcon=$('#editIcon').value||'original';
    node.editScale=Number($('#editScale').value||1);
    node.editOpacity=Number($('#editOpacity').value||100)/100;
  }else{
    node.editColor=$('#editColorLine').value;
    node.editWeight=Number($('#editLineWidth').value||node.style?.weight||4);
    node.editOpacity=Number($('#editLineOpacity').value||100)/100;
  }
  const patch={weight:node.editWeight,opacity:node.editOpacity,icon:node.editIcon||'original',scale:node.editScale||1};
  if(node.isPoint){
    const lat=Number(String($('#editLat').value).replace(',','.')),lng=Number(String($('#editLng').value).replace(',','.'));
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180){
      node.pointLayer.setLatLng([lat,lng]);if(node.pointIconLayer)node.pointIconLayer.setLatLng([lat,lng]);patch.pointCoord=[lat,lng];
    }
  }
  applyImportedVisual(node);
  persistImportedEdit(node,patch);
  closeModal();showImportedFeature(node);refreshPointLabels();
  status(node.name+' atualizado na Navegação.');
}
function startImportedPointMove(node){
  if(!node.pointLayer)return;
  if(importedPointMoveHandle&&map.hasLayer(importedPointMoveHandle))map.removeLayer(importedPointMoveHandle);
  const ll=node.pointLayer.getLatLng();
  const icon=L.divIcon({className:'import-move-icon',html:'<span></span>',iconSize:[24,24],iconAnchor:[12,12]});
  importedPointMoveHandle=L.marker(ll,{icon,draggable:true,zIndexOffset:4000,pane:'editPane',autoPan:true}).addTo(map);
  importedPointMoveHandle.on('drag',e=>{node.pointLayer.setLatLng(e.target.getLatLng());if(node.pointIconLayer)node.pointIconLayer.setLatLng(e.target.getLatLng())});
  importedPointMoveHandle.on('dragend',e=>{
    const p=e.target.getLatLng();node.pointLayer.setLatLng(p);if(node.pointIconLayer)node.pointIconLayer.setLatLng(p);persistImportedEdit(node,{pointCoord:[p.lat,p.lng]});
    map.removeLayer(importedPointMoveHandle);importedPointMoveHandle=null;showImportedFeature(node);refreshPointLabels();status(node.name+' reposicionado.');
  });
  status('Arraste o ponto azul para reposicionar '+node.name+'.');
}
function restoreImportedOriginal(node){
  if(!confirm('Restaurar este elemento para os dados originais do KMZ?'))return;
  delete importedEdits[node.editKey];saveImportedEdits();
  node.name=node.originalName;node.note=node.originalNote;node.editColor=node.style?.color||'#ff3b30';node.editIcon='original';node.editScale=1;node.editWeight=node.style?.weight||3;node.editOpacity=node.style?.opacity??1;
  if(node.pointLayer&&node._originalPoint)node.pointLayer.setLatLng(node._originalPoint);
  if(node.lineParts?.[0]&&node._originalLine){node.lineParts[0].coords=node._originalLine.map(c=>[...c]);node.lineParts[0].layer.setLatLngs(node.lineParts[0].coords)}
  applyImportedVisual(node);updateImportedSearch(node);showImportedFeature(node);refreshPointLabels();
}

function startImportedLineEdit(node){
  const part=node.lineParts?.[0];if(!part)return;
  closeImportedPanel();clearTemp();currentTool='import-edit';importedGeometryTarget=node;tempPoints=part.coords.map(c=>[...c]);
  node._editOpacity=(node.editOpacity??node.style?.opacity??1)*(node._docOpacity??1);part.layer.setStyle({opacity:.18});
  document.querySelector('[data-tab="tools"]')?.click();
  $('#toolHelp').textContent='Editar traçado existente: arraste os pontos azuis e pressione Finalizar para salvar.';
  $('#cancelTool').disabled=false;redrawTemp();
  status('Editando '+node.name+'. Arraste os pontos azuis e finalize para salvar.');
}
function finishImportedLineEdit(){
  const node=importedGeometryTarget,part=node?.lineParts?.[0];if(!node||!part||tempPoints.length<2)return;
  part.coords=tempPoints.map(c=>[...c]);part.layer.setLatLngs(part.coords);
  persistImportedEdit(node,{lineCoords:part.coords});applyImportedVisual(node);
  clearTemp();currentTool=null;importedGeometryTarget=null;$('#cancelTool').disabled=true;$('#finishTool').disabled=true;
  showImportedFeature(node);status(node.name+' teve o traçado atualizado na Navegação.');
}
function cancelImportedLineEdit(){
  if(importedGeometryTarget)applyImportedVisual(importedGeometryTarget);
  clearTemp();currentTool=null;importedGeometryTarget=null;$('#cancelTool').disabled=true;$('#finishTool').disabled=true;
  status('Edição do traçado cancelada.');
}


function loadProjects(){
  try{
    const v=JSON.parse(localStorage.getItem(PROJECT_STORE)||'[]');
    return Array.isArray(v)?v:[];
  }catch{return []}
}
function loadActiveProjectId(list=projects){
  try{
    const saved=localStorage.getItem(PROJECT_ACTIVE_STORE)||'';
    if(saved&&list.some(p=>p.id===saved))return saved;
  }catch{}
  return list[0]?.id||'';
}
function openProjectDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(new Error('IndexedDB indisponível'));return}
    const req=indexedDB.open(PROJECT_DB_NAME,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(PROJECT_DB_OBJECT))db.createObjectStore(PROJECT_DB_OBJECT,{keyPath:'key'})};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Falha ao abrir armazenamento local'));
  });
}
async function saveProjectsDb(payload){
  const db=await openProjectDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(PROJECT_DB_OBJECT,'readwrite');
    tx.objectStore(PROJECT_DB_OBJECT).put({key:PROJECT_STORE,...payload});
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Falha ao salvar projetos'));
  });
  db.close();
}
async function readProjectsDb(){
  const db=await openProjectDb();
  const value=await new Promise((resolve,reject)=>{
    const tx=db.transaction(PROJECT_DB_OBJECT,'readonly'),req=tx.objectStore(PROJECT_DB_OBJECT).get(PROJECT_STORE);
    req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error('Falha ao ler projetos'));
  });
  db.close();return value;
}
function saveProjects(){
  const updatedAt=Date.now(),payload={projects,activeProjectId,updatedAt};
  try{
    localStorage.setItem(PROJECT_STORE,JSON.stringify(projects));
    localStorage.setItem(PROJECT_ACTIVE_STORE,activeProjectId||'');
    localStorage.setItem(PROJECT_TS_STORE,String(updatedAt));
  }catch(e){
    console.warn('Projeto excedeu o armazenamento simples; usando IndexedDB.',e);
  }
  saveProjectsDb(payload).catch(e=>console.warn('Falha no backup IndexedDB dos projetos.',e));
}
async function hydrateProjectsDb(){
  try{
    const dbState=await readProjectsDb();
    const localTs=Number(localStorage.getItem(PROJECT_TS_STORE)||0);
    if(dbState?.projects&&Array.isArray(dbState.projects)&&Number(dbState.updatedAt||0)>localTs){
      projects=dbState.projects;
      activeProjectId=dbState.activeProjectId&&projects.some(p=>p.id===dbState.activeProjectId)?dbState.activeProjectId:(projects[0]?.id||'');
      try{
        localStorage.setItem(PROJECT_STORE,JSON.stringify(projects));
        localStorage.setItem(PROJECT_ACTIVE_STORE,activeProjectId||'');
        localStorage.setItem(PROJECT_TS_STORE,String(dbState.updatedAt||Date.now()));
      }catch{}
      renderProjects();
      status('Projetos KMZ restaurados do armazenamento local seguro.');
    }else if(!dbState){
      saveProjects();
    }
  }catch(e){
    console.warn('IndexedDB de projetos indisponível; mantendo armazenamento atual.',e);
  }
}
function activeProject(){return projects.find(p=>p.id===activeProjectId)||null}
function makeProject(name){
  return {id:uid('prj'),name:String(name||'Novo projeto KMZ').trim()||'Novo projeto KMZ',createdAt:new Date().toISOString(),root:{id:uid('pf'),type:'folder',name:'Projeto',expanded:true,children:[]}};
}
function findProjectNode(root,id,parent=null){
  if(!root)return null;
  if(root.id===id)return {node:root,parent};
  for(const ch of root.children||[]){const r=findProjectNode(ch,id,root);if(r)return r}
  return null;
}
function projectFolders(root,out=[]){
  if(!root)return out;
  if(root.type==='folder')out.push(root);
  (root.children||[]).forEach(ch=>projectFolders(ch,out));
  return out;
}
function projectItems(root,out=[]){
  if(!root)return out;
  if(root.type==='item')out.push(root);
  (root.children||[]).forEach(ch=>projectItems(ch,out));
  return out;
}
function targetProjectFolder(project){
  if(!project)return null;
  const found=selectedProjectNodeId?findProjectNode(project.root,selectedProjectNodeId):null;
  if(found?.node?.type==='folder')return found.node;
  if(found?.parent?.type==='folder')return found.parent;
  return project.root;
}
function snapshotImportedForProject(node){
  if(!node)return null;
  const geometries=[];
  if(node.pointLayer){const ll=node.pointLayer.getLatLng();geometries.push({type:'Point',coords:[[ll.lat,ll.lng]]})}
  (node.lineParts||[]).forEach(p=>geometries.push({type:'LineString',coords:p.coords.map(c=>[Number(c[0]),Number(c[1])])}));
  (node.polygonParts||[]).forEach(p=>geometries.push({type:'Polygon',coords:p.coords.map(c=>[Number(c[0]),Number(c[1])])}));
  if(!geometries.length)return null;
  return {id:uid('pi'),type:'item',name:node.name||'Sem nome',note:stripHtml(node.note||''),color:node.editColor||node.style?.color||'#ff3b30',weight:node.editWeight||node.style?.weight||3,source:node.source||'KMZ/KML',sourcePath:node.path||'',icon:node.editIcon||'original',scale:node.editScale||1,opacity:node.editOpacity??node.style?.opacity??1,geometries};
}
function snapshotAnnotationForProject(a){
  if(!a)return null;
  if(a.type==='circle'){
    const poly=circlePolygon(a.coords?.[0]||[0,0],Number(a.radius||0));
    return {id:uid('pi'),type:'item',name:a.name||'Sem nome',note:a.note||'',color:a.color||'#ff3b30',weight:a.weight||3,source:'Meus desenhos',sourcePath:'',icon:a.icon||'pin',scale:a.scale||1,opacity:a.opacity??1,geometries:[{type:'Polygon',coords:poly}]};
  }
  const t=a.type==='marker'?'Point':a.type==='area'?'Polygon':'LineString';
  return {id:uid('pi'),type:'item',name:a.name||'Sem nome',note:a.note||'',color:a.color||'#ff3b30',weight:a.weight||4,source:'Meus desenhos',sourcePath:'',icon:a.icon||'pin',scale:a.scale||1,opacity:a.opacity??1,geometries:[{type:t,coords:(a.coords||[]).map(c=>[Number(c[0]),Number(c[1])])}]};
}
function addProjectItem(item,folder=null){
  const p=activeProject();if(!p||!item)return false;
  (folder||targetProjectFolder(p)||p.root).children.push(item);
  saveProjects();renderProjects();status(item.name+' adicionado ao projeto '+p.name+'.');return true;
}
function projectNodeCount(node){
  if(!node)return 0;
  return node.type==='item'?1:(node.children||[]).reduce((n,ch)=>n+projectNodeCount(ch),0);
}
function projectFolderPath(root,targetId,path=[]){
  if(root.id===targetId)return path;
  for(const ch of root.children||[]){
    if(ch.type!=='folder')continue;
    const r=projectFolderPath(ch,targetId,[...path,ch.name]);if(r)return r;
  }
  return null;
}

function snapshotImportedTreeForProject(node){
  if(!node)return null;
  if(node.type==='placemark')return snapshotImportedForProject(node);
  const children=(node.children||[]).map(snapshotImportedTreeForProject).filter(Boolean);
  return {id:uid('pf'),type:'folder',name:node.name||'Pasta',expanded:true,visible:true,children};
}
function addImportedTreeToProject(node){
  const p=activeProject();if(!p){alert('Crie ou selecione um projeto em Projetos KMZ.');return}
  const snap=snapshotImportedTreeForProject(node);if(!snap){alert('Não há elementos compatíveis nesta pasta.');return}
  const folder=chooseProjectFolder();if(!folder)return;
  const count=projectNodeCount(snap);
  if(count>1500&&$('#projectPreview'))$('#projectPreview').checked=false;
  folder.children.push(snap);saveProjects();renderProjects();
  status((node.name||'Pasta')+' adicionado ao projeto '+p.name+' com '+count.toLocaleString('pt-BR')+' item(ns).'+(count>1500?' A pré-visualização foi pausada para manter o mapa rápido.':''));
}
function projectItemLayer(item){
  const layers=[],color=item.color||'#ff3b30',weight=Number(item.weight||4),opacity=Number(item.opacity??1);
  for(const g of item.geometries||[]){
    if(g.type==='Point'){
      const c=g.coords?.[0];if(!c)continue;
      const kind=item.icon&&item.icon!=='original'?item.icon:'pin';
      const m=L.marker(c,{pane:'projectPane',icon:markerIcon({color,icon:kind,scale:item.scale||1,opacity}),zIndexOffset:1200});
      layers.push(m);
    }else if(g.type==='Polygon'){
      const p=L.polygon(g.coords||[],{pane:'projectPane',color,weight,opacity,fillColor:color,fillOpacity:Math.min(.35,opacity*.25)});
      layers.push(p);
    }else{
      const l=L.polyline(g.coords||[],{pane:'projectPane',color,weight,opacity});
      layers.push(l);
    }
  }
  if(!layers.length)return null;
  const group=L.featureGroup(layers);
  layers.forEach(l=>{
    l.on('click',e=>{if(currentTool||driving)return;L.DomEvent.stopPropagation(e);selectedProjectNodeId=item.id;renderProjects(false);showProjectItemInfo(item)});
    l.on('contextmenu',e=>showProjectContextMenu(item,e));
  });
  return group;
}
function renderProjectMap(){
  projectLayerGroup.clearLayers();projectLayerIndex.clear();
  const p=activeProject();if(!p||!$('#projectPreview')?.checked)return;
  const walk=(node,parentVisible=true)=>{
    const visible=parentVisible&&node.visible!==false;
    if(node.type==='item'){
      if(!visible)return;
      const layer=projectItemLayer(node);if(layer){projectLayerGroup.addLayer(layer);projectLayerIndex.set(node.id,layer)}
      return;
    }
    for(const ch of node.children||[])walk(ch,visible);
  };
  walk(p.root,true);
}
function setProjectNodeVisible(node,visible){
  node.visible=visible;
  if(node.type==='folder')(node.children||[]).forEach(ch=>setProjectNodeVisible(ch,visible));
  saveProjects();renderProjects();
}
function fitProjectNode(node){
  if(!node)return;
  const pts=[];
  const collect=n=>{
    if(n.type==='item'){
      for(const g of n.geometries||[])for(const c of g.coords||[])if(Array.isArray(c)&&Number.isFinite(Number(c[0]))&&Number.isFinite(Number(c[1])))pts.push([Number(c[0]),Number(c[1])]);
    }else (n.children||[]).forEach(collect);
  };
  collect(node);if(!pts.length)return;
  if(pts.length===1){map.setView(pts[0],18,{animate:true});return}
  try{const b=L.latLngBounds(pts);if(b.isValid())map.fitBounds(b.pad(.15),{maxZoom:18})}catch{}
}
function cloneProjectNode(node){
  const copy=JSON.parse(JSON.stringify(node));
  const reId=n=>{n.id=uid(n.type==='folder'?'pf':'pi');(n.children||[]).forEach(reId)};
  reId(copy);copy.name=(copy.name||'Item')+' - cópia';return copy;
}
function duplicateProjectNode(node){
  const p=activeProject();if(!p)return;
  const found=findProjectNode(p.root,node.id);if(!found?.parent)return;
  const copy=cloneProjectNode(node);found.parent.children.push(copy);selectedProjectNodeId=copy.id;saveProjects();renderProjects();status(copy.name+' duplicado.');
}

function renderProjects(refreshMap=true){
  const select=$('#projectSelect'),tree=$('#projectTree'),info=$('#projectInfo');
  if(!select||!tree)return;
  select.innerHTML=projects.length?projects.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===activeProjectId?'selected':'')+'>'+esc(p.name)+'</option>').join(''):'<option value="">Nenhum projeto</option>';
  const p=activeProject();
  $('#newProjectFolder').disabled=!p;$('#renameProject').disabled=!p;$('#deleteProject').disabled=!p;
  $('#addSelectedToProject').disabled=!p;$('#addDrawingToProject').disabled=!p;$('#exportProjectKml').disabled=!p;$('#exportProjectKmz').disabled=!p;
  if(!p){tree.className='project-tree empty';tree.textContent='Crie um projeto para montar um novo KMZ.';info.innerHTML='';if(refreshMap)renderProjectMap();return}
  info.innerHTML='<b>'+esc(p.name)+'</b><span>'+projectNodeCount(p.root)+' item(ns) no projeto</span>';
  tree.className='project-tree';tree.innerHTML='';
  const draw=(node,parent,depth=0)=>{
    if(node!==p.root){
      const row=document.createElement('div');row.className='project-row'+(node.id===selectedProjectNodeId?' selected':'');row.style.paddingLeft=(8+depth*14)+'px';row.dataset.projectNode=node.id;
      if(node.type==='folder'){
        row.innerHTML='<button class="project-exp">'+(node.expanded===false?'▸':'▾')+'</button><input class="project-check" type="checkbox" '+(node.visible!==false?'checked':'')+'><span class="project-icon">📁</span><span class="project-name">'+esc(node.name)+'</span><div class="project-row-actions"><button class="mini add">＋</button><button class="mini duplicate">Duplicar</button><button class="mini move">Mover</button><button class="mini rename">Renomear</button><button class="mini delete">Excluir</button></div>';
        row.querySelector('.project-exp').onclick=e=>{e.stopPropagation();node.expanded=node.expanded===false?true:false;saveProjects();renderProjects(false)};
        row.querySelector('.project-check').onchange=e=>{e.stopPropagation();setProjectNodeVisible(node,e.target.checked)};
        row.querySelector('.add').onclick=e=>{e.stopPropagation();selectedProjectNodeId=node.id;createProjectFolder()};
        row.querySelector('.duplicate').onclick=e=>{e.stopPropagation();duplicateProjectNode(node)};
        row.querySelector('.move').onclick=e=>{e.stopPropagation();moveProjectNode(node)};
        row.querySelector('.rename').onclick=e=>{e.stopPropagation();renameProjectNode(node)};
      }else{
        const g=node.geometries?.[0]?.type||'Item',ico=g==='Point'?'📍':g==='Polygon'?'▱':'〰️';
        row.innerHTML='<span class="project-exp"></span><input class="project-check" type="checkbox" '+(node.visible!==false?'checked':'')+'><span class="project-icon">'+ico+'</span><span class="project-name">'+esc(node.name)+'</span><div class="project-row-actions"><button class="mini info">Info</button><button class="mini edit">Editar</button><button class="mini duplicate">Duplicar</button><button class="mini move">Mover</button><button class="mini rename">Renomear</button><button class="mini delete">Excluir</button></div>';
        row.querySelector('.project-check').onchange=e=>{e.stopPropagation();setProjectNodeVisible(node,e.target.checked)};
        row.querySelector('.info').onclick=e=>{e.stopPropagation();showProjectItemInfo(node)};
        row.querySelector('.edit').onclick=e=>{e.stopPropagation();openProjectItemEdit(node)};
        row.querySelector('.duplicate').onclick=e=>{e.stopPropagation();duplicateProjectNode(node)};
        row.querySelector('.move').onclick=e=>{e.stopPropagation();moveProjectNode(node)};
        row.querySelector('.rename').onclick=e=>{e.stopPropagation();renameProjectNode(node)};
      }
      row.querySelector('.delete').onclick=e=>{e.stopPropagation();removeProjectNode(node)};
      row.querySelector('.project-name').onclick=e=>{e.stopPropagation();selectedProjectNodeId=node.id;renderProjects(false);fitProjectNode(node);if(node.type==='item')showProjectItemInfo(node)};
      row.onclick=()=>{selectedProjectNodeId=node.id;renderProjects(false)};
      row.draggable=true;
      row.ondragstart=e=>{e.dataTransfer.setData('text/project-node',node.id);e.dataTransfer.effectAllowed='move';row.classList.add('dragging')};
      row.ondragend=()=>row.classList.remove('dragging');
      if(node.type==='folder'){
        row.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';row.classList.add('drop-target')};
        row.ondragleave=()=>row.classList.remove('drop-target');
        row.ondrop=e=>{e.preventDefault();row.classList.remove('drop-target');const id=e.dataTransfer.getData('text/project-node');const src=findProjectNode(p.root,id)?.node;if(src&&src!==node)moveProjectNodeToFolder(src,node)};
      }
      parent.appendChild(row);
    }
    if(node.type==='folder'&&node.expanded!==false)(node.children||[]).forEach(ch=>draw(ch,parent,depth+(node===p.root?0:1)));
  };
  draw(p.root,tree,0);
  tree.ondragover=e=>{if(e.target===tree){e.preventDefault();tree.classList.add('drop-root')}};
  tree.ondragleave=e=>{if(e.target===tree)tree.classList.remove('drop-root')};
  tree.ondrop=e=>{if(e.target!==tree)return;e.preventDefault();tree.classList.remove('drop-root');const id=e.dataTransfer.getData('text/project-node');const src=findProjectNode(p.root,id)?.node;if(src)moveProjectNodeToFolder(src,p.root)};
  if(!p.root.children.length){tree.classList.add('empty');tree.innerHTML='<div class="project-empty">Projeto vazio. Crie pastas ou adicione itens existentes.</div>'}
  if(refreshMap)renderProjectMap();
}
function createProject(){
  const name=prompt('Nome do novo projeto KMZ:','Novo projeto KMZ');if(name===null)return;
  const p=makeProject(name);projects.push(p);activeProjectId=p.id;selectedProjectNodeId='';saveProjects();renderProjects();
  document.querySelector('[data-tab="projects"]')?.click();status('Projeto '+p.name+' criado.');
}
function createProjectFolder(){
  const p=activeProject();if(!p)return;
  const parent=targetProjectFolder(p)||p.root;
  const name=prompt('Nome da nova pasta:','Nova pasta');if(name===null||!name.trim())return;
  const folder={id:uid('pf'),type:'folder',name:name.trim(),expanded:true,children:[]};parent.children.push(folder);selectedProjectNodeId=folder.id;saveProjects();renderProjects();
}

function projectNodeIds(node,set=new Set()){
  set.add(node.id);(node.children||[]).forEach(ch=>projectNodeIds(ch,set));return set;
}

function moveProjectNodeToFolder(node,target){
  const p=activeProject();if(!p||!node||!target||target.type!=='folder'||node===p.root)return false;
  if(projectNodeIds(node).has(target.id))return false;
  const found=findProjectNode(p.root,node.id);if(!found?.parent||found.parent===target)return false;
  found.parent.children=found.parent.children.filter(x=>x.id!==node.id);
  target.children.push(node);target.expanded=true;selectedProjectNodeId=node.id;saveProjects();renderProjects();
  status(node.name+' movido para '+(target===p.root?'raiz do projeto':target.name)+'.');return true;
}

function moveProjectNode(node){
  const p=activeProject();if(!p||node===p.root)return;
  const found=findProjectNode(p.root,node.id);if(!found?.parent)return;
  const forbidden=projectNodeIds(node);
  const folders=projectFolders(p.root).filter(f=>!forbidden.has(f.id));
  if(!folders.length)return;
  const lines=folders.map((f,i)=>((i+1)+'. '+(f===p.root?'Raiz do projeto':(projectFolderPath(p.root,f.id)||[]).join(' › ')))).join('\n');
  const raw=prompt('Mover "'+node.name+'" para qual pasta?\n\n'+lines,'1');if(raw===null)return;
  const idx=Math.max(0,Math.min(folders.length-1,Number(raw)-1)),target=folders[Number.isFinite(idx)?idx:0];if(!target)return;
  found.parent.children=found.parent.children.filter(x=>x.id!==node.id);target.children.push(node);target.expanded=true;selectedProjectNodeId=node.id;saveProjects();renderProjects();status(node.name+' movido no projeto.');
}

function renameProjectNode(node){
  const name=prompt('Novo nome:',node.name);if(name===null||!name.trim())return;node.name=name.trim();saveProjects();renderProjects();
}
function removeProjectNode(node){
  const p=activeProject();if(!p)return;
  const found=findProjectNode(p.root,node.id);if(!found?.parent)return;
  const count=projectNodeCount(node);
  if(!confirm('Remover '+node.name+' deste projeto'+(count>1?' e seus '+count+' itens':'')+'?\n\nO arquivo original não será apagado.'))return;
  found.parent.children=found.parent.children.filter(x=>x.id!==node.id);if(selectedProjectNodeId===node.id)selectedProjectNodeId='';saveProjects();renderProjects();
}
function renameActiveProject(){
  const p=activeProject();if(!p)return;const name=prompt('Novo nome do projeto:',p.name);if(name===null||!name.trim())return;p.name=name.trim();saveProjects();renderProjects();
}
function deleteActiveProject(){
  const p=activeProject();if(!p)return;if(!confirm('Excluir o projeto "'+p.name+'"?\n\nIsso não apaga nenhum KMZ/KML original.'))return;
  projects=projects.filter(x=>x.id!==p.id);activeProjectId=projects[0]?.id||'';selectedProjectNodeId='';saveProjects();renderProjects();
}
function chooseProjectFolder(){
  const p=activeProject();if(!p)return null;
  const folders=projectFolders(p.root);
  if(folders.length<=1)return p.root;
  const lines=folders.map((f,i)=>((i+1)+'. '+(f===p.root?'Raiz do projeto':(projectFolderPath(p.root,f.id)||[]).join(' › ')))).join('\n');
  const raw=prompt('Em qual pasta deseja adicionar?\n\n'+lines,'1');
  if(raw===null)return null;const idx=Math.max(0,Math.min(folders.length-1,Number(raw)-1));return folders[Number.isFinite(idx)?idx:0]||p.root;
}
function addSelectedImportedToProject(){
  const p=activeProject();if(!p){alert('Crie ou selecione um projeto primeiro.');return}
  if(!selectedImported){alert('Selecione primeiro um ponto, traçado ou outro elemento em Camadas ou no mapa.');return}
  const item=snapshotImportedForProject(selectedImported);if(!item){alert('Este elemento não possui geometria compatível.');return}
  const folder=chooseProjectFolder();if(!folder)return;addProjectItem(item,folder);
}
function addDrawingSavedToProject(){
  const p=activeProject();if(!p){alert('Crie ou selecione um projeto primeiro.');return}
  if(!annotations.length){alert('Não há desenhos salvos em Meus desenhos.');return}
  const lines=annotations.map((a,i)=>(i+1)+'. '+a.name).join('\n');
  const raw=prompt('Qual desenho deseja adicionar ao projeto?\n\n'+lines,'1');if(raw===null)return;
  const a=annotations[Math.max(0,Math.min(annotations.length-1,Number(raw)-1))];if(!a)return;
  const folder=chooseProjectFolder();if(!folder)return;addProjectItem(snapshotAnnotationForProject(a),folder);
}

function openProjectItemEdit(item){
  if(!item)return;
  pendingEdit={projectItem:item};
  const geom=item.geometries?.[0]?.type||'LineString',isPoint=geom==='Point';
  $('#modalTitle').textContent='Editar item do projeto';
  $('#editName').value=item.name||'';
  $('#editNote').value=item.note||'';
  $('#markerStylePanel').classList.toggle('hidden',!isPoint);
  $('#lineStylePanel').classList.toggle('hidden',isPoint);
  $('#markerPositionFields').classList.toggle('hidden',!isPoint);
  if(isPoint){
    const c=item.geometries?.[0]?.coords?.[0]||[0,0];
    $('#editLat').value=Number(c[0]).toFixed(7);$('#editLng').value=Number(c[1]).toFixed(7);
    $('#editColor').value=item.color||'#1688ff';$('#editIcon').value=item.icon||'pin';$('#editScale').value=String(item.scale||1);$('#editOpacity').value=String(Math.round(Number(item.opacity??1)*100));refreshIconPalette();
  }else{
    $('#editColorLine').value=item.color||'#ff3b30';$('#editLineWidth').value=String(item.weight||4);$('#editLineOpacity').value=String(Math.round(Number(item.opacity??1)*100));
    $('#lineWidthValue').textContent=$('#editLineWidth').value+' px';$('#lineOpacityValue').textContent=$('#editLineOpacity').value+'%';
  }
  $('#modal').classList.remove('hidden');setTimeout(()=>$('#editName').focus(),50);
}
function saveProjectItemFromModal(item){
  const geom=item.geometries?.[0]?.type||'LineString',isPoint=geom==='Point';
  item.name=$('#editName').value.trim()||item.name||'Sem nome';item.note=$('#editNote').value.trim();
  if(isPoint){
    item.color=$('#editColor').value;item.icon=$('#editIcon').value||'pin';item.scale=Number($('#editScale').value||1);item.opacity=Number($('#editOpacity').value||100)/100;
    const lat=Number(String($('#editLat').value).replace(',','.')),lng=Number(String($('#editLng').value).replace(',','.'));
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)item.geometries[0].coords=[[lat,lng]];
  }else{
    item.color=$('#editColorLine').value;item.weight=Number($('#editLineWidth').value||4);item.opacity=Number($('#editLineOpacity').value||100)/100;
  }
  saveProjects();closeModal();renderProjects();showProjectItemInfo(item);status(item.name+' atualizado no projeto.');
}

function showProjectItemInfo(item){
  if(isMobileUi())closeMobileSheet();
  const panel=ensureImportedPanel();
  const geom=item.geometries?.[0]?.type||'Item',isPoint=geom==='Point',isLine=geom==='LineString';
  let details='';
  if(isPoint){
    const c=item.geometries?.[0]?.coords?.[0]||[0,0];
    details='<div class="imported-detail-row"><span>Coordenadas</span><b>'+Number(c[0]).toFixed(6)+', '+Number(c[1]).toFixed(6)+'</b><small>'+esc(toDms(Number(c[0]),true)+' · '+toDms(Number(c[1]),false))+'</small></div>';
  }else if(isLine){
    details='<div class="imported-detail-row"><span>Comprimento</span><b>'+fmtDistance(distanceOf(item.geometries?.[0]?.coords||[]))+'</b></div>';
  }
  panel.innerHTML='<div class="imported-head"><div><span>ITEM DO PROJETO</span><h3>'+esc(item.name)+'</h3></div><button id="closeImportedPanel" type="button">×</button></div>'+
    '<div class="imported-source"><b>Origem:</b> '+esc(item.source||'Projeto')+'</div>'+
    (item.sourcePath?'<div class="imported-path">'+esc(item.sourcePath)+'</div>':'')+
    '<div class="imported-detail-row"><span>Tipo</span><b>'+esc(geom)+'</b></div>'+
    '<div class="imported-detail-row"><span>Informações</span><p>'+(item.note?esc(item.note):'Sem observação cadastrada.')+'</p></div>'+details+
    '<div class="imported-actions"><button class="btn primary" id="editProjectItem">Editar</button><button class="btn secondary" id="zoomProjectItem">Ir para item</button>'+
    (isPoint?'<button class="btn secondary" id="navigateProjectItem">🚗 Navegar até aqui</button><button class="btn secondary" id="copyProjectCoords">Copiar coordenadas</button>':'')+
    (isLine?'<button class="btn secondary" id="projectElevation">Perfil de elevação</button>':'')+
    '</div>';
  panel.classList.remove('hidden');
  panel.querySelector('#closeImportedPanel').onclick=()=>panel.classList.add('hidden');
  panel.querySelector('#editProjectItem').onclick=()=>openProjectItemEdit(item);
  panel.querySelector('#zoomProjectItem').onclick=()=>fitProjectNode(item);
  if(isPoint){
    const c=item.geometries?.[0]?.coords?.[0]||[0,0];
    panel.querySelector('#navigateProjectItem').onclick=()=>{setNavigationTarget(c[0],c[1],item.name||'Destino do projeto','Projeto KMZ');panel.classList.add('hidden');startMeasuredNavigation()};
    panel.querySelector('#copyProjectCoords').onclick=()=>copyText(Number(c[0]).toFixed(6)+', '+Number(c[1]).toFixed(6),'Coordenadas copiadas.');
  }
  if(isLine)panel.querySelector('#projectElevation').onclick=()=>showElevationProfile(item.geometries?.[0]?.coords||[],item.name);
}
function projectItemKml(item){
  const alpha=Math.round(Math.max(.2,Math.min(1,Number(item.opacity??1)))*255).toString(16).padStart(2,'0');
  const col=alpha+(item.color||'#ff3b30').slice(1).match(/../g).reverse().join('');
  const hasPoint=(item.geometries||[]).some(g=>g.type==='Point');
  const style='<Style>'+(hasPoint?'<IconStyle><color>'+col+'</color><scale>'+(item.scale||1)+'</scale></IconStyle><LabelStyle><color>'+col+'</color></LabelStyle>':'')+'<LineStyle><color>'+col+'</color><width>'+(item.weight||4)+'</width></LineStyle><PolyStyle><color>55'+(item.color||'#ff3b30').slice(1).match(/../g).reverse().join('')+'</color></PolyStyle></Style>';
  const geoms=(item.geometries||[]).map(g=>{
    if(g.type==='Point'){const c=g.coords?.[0]||[0,0];return '<Point><coordinates>'+c[1]+','+c[0]+',0</coordinates></Point>'}
    if(g.type==='Polygon'){const c=[...(g.coords||[])];if(c.length&&String(c[0])!==String(c[c.length-1]))c.push(c[0]);return '<Polygon><outerBoundaryIs><LinearRing><coordinates>'+c.map(x=>x[1]+','+x[0]+',0').join(' ')+'</coordinates></LinearRing></outerBoundaryIs></Polygon>'}
    return '<LineString><tessellate>1</tessellate><coordinates>'+(g.coords||[]).map(x=>x[1]+','+x[0]+',0').join(' ')+'</coordinates></LineString>';
  }).join('');
  return '<Placemark><name>'+xmlEsc(item.name)+'</name>'+(item.note?'<description>'+xmlEsc(item.note)+'</description>':'')+style+(geoms.includes('</')&&item.geometries.length>1?'<MultiGeometry>'+geoms+'</MultiGeometry>':geoms)+'</Placemark>';
}
function projectFolderKml(folder,isRoot=false){
  const body=(folder.children||[]).map(ch=>ch.type==='folder'?projectFolderKml(ch,false):projectItemKml(ch)).join('');
  return isRoot?body:'<Folder><name>'+xmlEsc(folder.name)+'</name>'+body+'</Folder>';
}
function projectKml(){
  const p=activeProject();if(!p)return '';
  return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>'+xmlEsc(p.name)+'</name>'+projectFolderKml(p.root,true)+'</Document></kml>';
}
function safeFilename(v){return String(v||'projeto').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'projeto'}
function exportActiveProjectKml(){
  const p=activeProject();if(!p)return;downloadBlob(new Blob([projectKml()],{type:'application/vnd.google-earth.kml+xml'}),safeFilename(p.name)+'.kml');
}
async function exportActiveProjectKmz(){
  const p=activeProject();if(!p)return;const zip=new JSZip();zip.file('doc.kml',projectKml());const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});downloadBlob(blob,safeFilename(p.name)+'.kmz');
}

function loadAnnotations(){
  try{return JSON.parse(localStorage.getItem(STORE)||'[]')}catch{return []}
}
function saveAnnotations(){ localStorage.setItem(STORE,JSON.stringify(annotations)); }
function markerGlyph(kind){
  return ({original:'○',pin:'●',circle:'○',flag:'⚑',star:'★',alert:'△',check:'✓',tool:'◇',home:'⌂',car:'▰',truck:'▰',person:'●',camera:'▣',info:'i',question:'?',danger:'!',target:'◎',square:'■',diamond:'◆'})[kind]||'●';
}
function markerSvg(kind){
  const base='viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const p={
    original:'<circle cx="12" cy="12" r="7"/>',
    pin:'<path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11z"/><circle cx="12" cy="10" r="2"/>',
    circle:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>',
    flag:'<path d="M6 21V4"/><path d="M6 5h10l-2 3 2 3H6"/>',
    star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2 7.5 14 3 9.6l6.2-.9L12 3z"/>',
    alert:'<path d="M12 4 3 20h18L12 4z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    tool:'<path d="M14 6a4 4 0 0 0-5 5L3 17l4 4 6-6a4 4 0 0 0 5-5l-3 3-3-3 2-4z"/>',
    home:'<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    car:'<path d="m5 11 2-5h10l2 5"/><rect x="3" y="10" width="18" height="7" rx="2"/><path d="M6 17v2M18 17v2"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/>',
    truck:'<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    person:'<circle cx="12" cy="7" r="3"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/>',
    camera:'<path d="M4 8h4l2-3h4l2 3h4v11H4z"/><circle cx="12" cy="13" r="3"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/>',
    question:'<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.5 2.5 0 1 1 3.7 2.2c-1 .6-1.5 1.1-1.5 2.3"/><path d="M12 17h.01"/>',
    danger:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 17h.01"/>',
    target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    square:'<rect x="5" y="5" width="14" height="14" rx="2"/>',
    diamond:'<path d="m12 3 9 9-9 9-9-9 9-9z"/>'
  };
  return '<svg '+base+'>'+(p[kind]||p.pin)+'</svg>';
}
function markerIcon(a){
  const color=a.color||'#1688ff',kind=a.icon||'pin',scale=Number(a.scale||1),opacity=Math.max(.2,Math.min(1,Number(a.opacity??1)));
  return L.divIcon({
    className:'custom-annotation-icon',
    html:'<div class="custom-marker '+esc(kind)+'" style="--marker-color:'+esc(color)+';--marker-scale:'+scale+';--marker-opacity:'+opacity+'"><span>'+markerSvg(kind)+'</span></div>',
    iconSize:[38,46],iconAnchor:[19,42],popupAnchor:[0,-39]
  });
}
function initIconPalette(){
  $$('#iconPalette [data-icon]').forEach(b=>{b.innerHTML=markerSvg(b.dataset.icon)});
}
function annotationLayer(a){
  let layer;
  if(a.type==='marker'){
    layer=L.marker(a.coords[0],{icon:markerIcon(a),draggable:true,zIndexOffset:1800});
    layer.on('dragstart',()=>{layer.closePopup();status('Arraste o marcador para a nova posição.')});
    layer.on('dragend',e=>{
      const ll=e.target.getLatLng();a.coords=[[ll.lat,ll.lng]];saveAnnotations();
      status(a.name+' movido para '+ll.lat.toFixed(6)+', '+ll.lng.toFixed(6)+'.');
    });
    layer.on('dblclick',e=>{L.DomEvent.stop(e);openEditModal('marker',a.coords,a)});
  }else if(a.type==='circle'){
    const center=a.coords?.[0]||[0,0],radius=Number(a.radius||0);
    layer=L.circle(center,{radius,color:a.color||'#ff3b30',weight:Number(a.weight||3),opacity:Number(a.opacity??1),fillColor:a.color||'#ff3b30',fillOpacity:.14});
  }else if(a.type==='area'){
    layer=L.polygon(a.coords,{color:a.color||'#ff3b30',weight:Number(a.weight||3),opacity:Number(a.opacity??1),fillColor:a.color||'#ff3b30',fillOpacity:.18});
  }else{
    layer=L.polyline(a.coords,{color:a.color||'#ff3b30',weight:Number(a.weight||4),opacity:Number(a.opacity??1)});
  }
  const extra=a.type==='marker'
    ? '<div class="popup-note">Arraste este marcador para reposicionar.</div>'
    : a.type==='trace'||a.type==='measure'
      ? '<div class="popup-note">Distância: '+fmtDistance(distanceOf(a.coords))+'</div>'
      : a.type==='area'
        ? '<div class="popup-note">Área aproximada: '+fmtArea(areaOf(a.coords))+'</div>'
        : a.type==='circle'
          ? '<div class="popup-note">Raio: '+fmtDistance(a.radius||0)+' · Área: '+fmtArea(Math.PI*(a.radius||0)*(a.radius||0))+'</div>'
          : '';
  layer.bindPopup(popupHtml(a.name,a.note,extra));
  layer.on('contextmenu',e=>showAnnotationContextMenu(a,layer,e));
  return layer;
}
function renderAnnotations(){
  annotationLayers.forEach(l=>map.removeLayer(l)); annotationLayers.clear();
  const box=$('#annotationTree');box.innerHTML='';
  if(!annotations.length){box.className='tree empty';box.textContent='Nenhum marcador ou traçado criado.';return}
  box.className='tree';
  annotations.forEach(a=>{
    const layer=annotationLayer(a).addTo(map);annotationLayers.set(a.id,layer);
    const row=document.createElement('div');row.className='tree-row';
    const icon=a.type==='marker'?markerGlyph(a.icon||'pin'):a.type==='area'?'▱':a.type==='circle'?'◯':a.type==='measure'?'📏':'〰️';
    const profileBtn=['trace','measure'].includes(a.type)?'<button class="mini profile">Perfil</button>':'';
    row.innerHTML='<span class="tree-indent">'+icon+'</span><input class="tree-check" type="checkbox" checked><span class="tree-label">'+esc(a.name)+'</span><div class="tree-actions"><button class="mini project">Projeto</button>'+profileBtn+'<button class="mini edit">Editar</button><button class="mini delete">Excluir</button></div>';
    row.querySelector('.tree-check').onchange=e=>e.target.checked?layer.addTo(map):map.removeLayer(layer);
    row.querySelector('.profile')?.addEventListener('click',()=>showElevationProfile(a.coords,a.name));
    row.querySelector('.tree-label').onclick=()=>fitLayer(layer);
    row.querySelector('.project').onclick=()=>{const p=activeProject();if(!p){alert('Crie ou selecione um projeto em Projetos KMZ.');return}const folder=chooseProjectFolder();if(folder)addProjectItem(snapshotAnnotationForProject(a),folder)};
    row.querySelector('.edit').onclick=()=>openEditModal(a.type,a.coords,a);
    row.querySelector('.delete').onclick=()=>{if(confirm('Excluir "'+a.name+'"?')){annotations=annotations.filter(x=>x.id!==a.id);saveAnnotations();renderAnnotations();status('Item excluído.')}};
    box.appendChild(row);
  });
}

function clearTemp(){
  if(tempLayer&&map.hasLayer(tempLayer))map.removeLayer(tempLayer);
  tempVertexMarkers.forEach(m=>{if(map.hasLayer(m))map.removeLayer(m)});
  tempLayer=null;tempVertexMarkers=[];tempPoints=[];
  $('#undoPoint').disabled=true;$('#finishTool').disabled=true;$('#saveMeasurement').disabled=true;$('#setMeasuredTarget').disabled=true;
  $('#measureValue').textContent='0 m';
}
function setTool(name){
  if(name)closeImportedPanel();
  currentTool=name;clearTemp();
  $$('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===name));
  $('#cancelTool').disabled=!name;
  $('#undoPoint').disabled=true;
  $('#finishTool').disabled=true;
  $('#measurePanel').classList.toggle('hidden',!['measure','circle','area'].includes(name));
  $('#measureLabel').textContent=name==='circle'?'Raio do círculo':name==='area'?'Área aproximada':'Distância acumulada';
  $('#measureValue').textContent=name==='area'?'0 m²':'0 m';
  $('#saveMeasurement').textContent=name==='circle'?'Salvar círculo':name==='area'?'Salvar área':'Salvar medição';
  $('#setMeasuredTarget').classList.toggle('hidden',name!=='measure');
  $('.measure-destination-actions').classList.toggle('hidden',name!=='measure');
  const help={
    measure:'Toque no mapa seguindo o caminho. Depois, arraste qualquer ponto azul para ajustar a medição.',
    marker:'Toque no local exato onde deseja adicionar o marcador.',
    trace:'Toque ponto a ponto para desenhar o traçado. Você pode arrastar os pontos para ajustar.',
    area:'Toque nos vértices da área. Você pode arrastar os pontos para ajustar antes de finalizar.',
    circle:'Toque no centro e depois na borda. Arraste qualquer um dos dois pontos para ajustar o raio.'
  };
  $('#toolHelp').textContent=help[name]||'Escolha uma ferramenta e toque no mapa.';
  if(name) status('Ferramenta ativa: '+help[name]);
}
function updateTempGeometry(){
  if(currentTool==='area'){
    const area=tempPoints.length>=3?areaOf(tempPoints):0;
    $('#measureValue').textContent=fmtArea(area);$('#saveMeasurement').disabled=tempPoints.length<3;
    if(tempPoints.length>=3)status('Área aproximada: '+fmtArea(area)+' · '+tempPoints.length+' vértices');
    return;
  }
  if(currentTool==='circle'){
    if(tempPoints.length>=2){
      const radius=L.latLng(tempPoints[0]).distanceTo(L.latLng(tempPoints[1]));
      if(tempLayer?.setLatLng)tempLayer.setLatLng(tempPoints[0]);
      if(tempLayer?.setRadius)tempLayer.setRadius(radius);
      $('#measureValue').textContent=fmtMeasureDistance(radius);
      $('#saveMeasurement').disabled=false;$('#finishTool').disabled=false;
      status('Círculo · raio '+fmtMeasureDistance(radius)+' · circunferência '+fmtMeasureDistance(2*Math.PI*radius)+' · área '+fmtArea(Math.PI*radius*radius));
    }
    return;
  }
  if(tempLayer?.setLatLngs)tempLayer.setLatLngs(tempPoints);
  if(currentTool==='measure'){
    const dist=distanceOf(tempPoints);$('#measureValue').textContent=fmtMeasureDistance(dist);$('#saveMeasurement').disabled=tempPoints.length<2;$('#setMeasuredTarget').disabled=tempPoints.length<2;
    status('Medição: '+fmtMeasureDistance(dist)+' · '+tempPoints.length+' pontos · arraste os pontos azuis para ajustar');
  }
}
function insertTempVertex(latlng){
  if(currentTool!=='import-edit'||tempPoints.length<2)return;
  const p=map.latLngToContainerPoint(latlng);let best=Infinity,bestIndex=1;
  for(let i=1;i<tempPoints.length;i++){
    const a=map.latLngToContainerPoint(tempPoints[i-1]),b=map.latLngToContainerPoint(tempPoints[i]);
    const dist=pointSegDistance(p,a,b);if(dist<best){best=dist;bestIndex=i}
  }
  if(best>18){status('Para adicionar um ponto, clique mais próximo da linha azul.');return}
  tempPoints.splice(bestIndex,0,[latlng.lat,latlng.lng]);redrawTemp();
  status('Novo ponto inserido no traçado. Arraste para ajustar.');
}
function redrawTemp(){
  if(tempLayer&&map.hasLayer(tempLayer))map.removeLayer(tempLayer);
  tempVertexMarkers.forEach(m=>{if(map.hasLayer(m))map.removeLayer(m)});
  tempLayer=null;tempVertexMarkers=[];
  if(currentTool==='circle'){
    if(tempPoints.length>=2){
      const radius=L.latLng(tempPoints[0]).distanceTo(L.latLng(tempPoints[1]));
      tempLayer=L.circle(tempPoints[0],{radius,color:'#ffd54a',weight:3,fillColor:'#ffd54a',fillOpacity:.12,interactive:false}).addTo(map);
    }else if(tempPoints.length===1)tempLayer=L.circleMarker(tempPoints[0],{radius:5,color:'#ffd54a',fillOpacity:1}).addTo(map);
  }else if(currentTool==='measure'||currentTool==='trace'||currentTool==='import-edit'){
    if(tempPoints.length>1)tempLayer=L.polyline(tempPoints,{pane:currentTool==='import-edit'?'editPane':'overlayPane',color:currentTool==='measure'?'#ffd54a':currentTool==='import-edit'?'#00b8ff':'#ff3b30',weight:currentTool==='import-edit'?6:4,dashArray:currentTool==='measure'?'8 7':null,interactive:false}).addTo(map);
  }else if(currentTool==='area'&&tempPoints.length>1){
    tempLayer=tempPoints.length>2
      ? L.polygon(tempPoints,{color:'#ff3b30',weight:3,fillOpacity:.15}).addTo(map)
      : L.polyline(tempPoints,{color:'#ff3b30',weight:3}).addTo(map);
  }
  if(['measure','trace','area','circle','import-edit'].includes(currentTool)){
    const handleIndexes=tempPoints.length>350?tempPoints.map((_,i)=>i).filter(i=>i%Math.ceil(tempPoints.length/350)===0||i===tempPoints.length-1):tempPoints.map((_,i)=>i);
    handleIndexes.forEach(i=>{const pt=tempPoints[i];
      const sz=currentTool==='import-edit'?26:18;const icon=L.divIcon({className:'temp-vertex-icon'+(currentTool==='import-edit'?' import-edit-handle':''),html:'<span></span>',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]});
      const marker=L.marker(pt,{icon,draggable:true,zIndexOffset:5000,pane:'editPane',autoPan:true,riseOnHover:true}).addTo(map);
      marker.on('drag',e=>{
        const ll=e.target.getLatLng();tempPoints[i]=[ll.lat,ll.lng];updateTempGeometry();
      });
      marker.on('dragend',()=>{updateTempGeometry();status((currentTool==='measure'?'Medição ajustada':'Ponto ajustado')+'.')});
      tempVertexMarkers.push(marker);
    });
  }
  $('#undoPoint').disabled=tempPoints.length===0;
  $('#finishTool').disabled=currentTool==='trace'?tempPoints.length<2:currentTool==='area'?tempPoints.length<3:currentTool==='circle'?tempPoints.length<2:currentTool==='measure'?tempPoints.length<2:currentTool==='import-edit'?tempPoints.length<2:true;
  updateTempGeometry();
}
function finishCurrent(){
  if(currentTool==='import-edit')return finishImportedLineEdit();
  if(currentTool==='circle'&&tempPoints.length>=2)return openEditModal('circle',[...tempPoints]);
  if(currentTool==='trace'&&tempPoints.length>=2)return openEditModal('trace',[...tempPoints]);
  if(currentTool==='area'&&tempPoints.length>=3)return openEditModal('area',[...tempPoints]);
  if(currentTool==='measure'&&tempPoints.length>=2){currentTool=null;$$('.tool').forEach(b=>b.classList.remove('active'));$('#cancelTool').disabled=true;status('Medição pausada em '+fmtDistance(distanceOf(tempPoints))+'. Você pode salvar ou limpar.')}
}
function refreshIconPalette(){
  const selected=$('#editIcon').value||'pin';
  $$('#iconPalette [data-icon]').forEach(b=>b.classList.toggle('selected',b.dataset.icon===selected));
  $('#scaleValue').textContent=Number($('#editScale').value||1).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'×';
  $('#opacityValue').textContent=Math.round(Number($('#editOpacity').value||100))+'%';
}
function openEditModal(type,coords,existing=null){
  pendingEdit={type,coords,existing};
  $('#modalTitle').textContent=existing?'Editar item':type==='marker'?'Novo marcador':type==='area'?'Salvar área':type==='circle'?'Salvar círculo':type==='measure'?'Salvar medição':'Salvar traçado';
  $('#editName').value=existing?.name||(
    type==='marker'?'Novo marcador':
    type==='area'?'Nova área':
    type==='circle'?'Novo círculo':
    type==='measure'?'Medição '+new Date().toLocaleString('pt-BR'):
    'Novo traçado'
  );
  $('#editNote').value=existing?.note||'';
  const isMarker=type==='marker';
  $('#markerStylePanel').classList.toggle('hidden',!isMarker);
  $('#markerPositionFields').classList.toggle('hidden',!isMarker);
  $('#lineStylePanel').classList.toggle('hidden',isMarker);
  if(isMarker){
    const c=(existing?.coords||coords)?.[0]||coords?.[0]||[-25.43,-49.27];
    $('#editLat').value=Number(c[0]).toFixed(7);$('#editLng').value=Number(c[1]).toFixed(7);
    $('#editColor').value=existing?.color||'#1688ff';
    $('#editIcon').value=existing?.icon||'pin';
    $('#editScale').value=String(existing?.scale||1);
    $('#editOpacity').value=String(Math.round(Number(existing?.opacity??1)*100));
    refreshIconPalette();
  }else{
    $('#editColorLine').value=existing?.color||'#ff3b30';
    $('#editLineWidth').value=String(existing?.weight||4);
    $('#editLineOpacity').value=String(Math.round(Number(existing?.opacity??1)*100));
    $('#lineWidthValue').textContent=$('#editLineWidth').value+' px';
    $('#lineOpacityValue').textContent=$('#editLineOpacity').value+'%';
  }
  $('#modal').classList.remove('hidden');setTimeout(()=>$('#editName').focus(),50);
}
function closeModal(){pendingEdit=null;$('#modal').classList.add('hidden')}
function saveModal(){
  if(!pendingEdit)return;
  if(pendingEdit.projectItem)return saveProjectItemFromModal(pendingEdit.projectItem);
  if(pendingEdit.imported)return saveImportedFromModal(pendingEdit.imported);
  let coords=pendingEdit.coords;
  const isMarker=pendingEdit.type==='marker';
  if(isMarker){
    const lat=Number(String($('#editLat').value).replace(',','.')),lng=Number(String($('#editLng').value).replace(',','.'));
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)coords=[[lat,lng]];
  }
  const circleRadius=pendingEdit.type==='circle'
    ? Number(pendingEdit.existing?.radius||((coords?.length>=2)?L.latLng(coords[0]).distanceTo(L.latLng(coords[1])):0))
    : Number(pendingEdit.existing?.radius||0);
  const item={
    id:pendingEdit.existing?.id||uid('a'),
    type:pendingEdit.type,
    name:$('#editName').value.trim()||'Sem nome',
    note:$('#editNote').value.trim(),
    color:isMarker?$('#editColor').value:$('#editColorLine').value,
    icon:isMarker?$('#editIcon').value:(pendingEdit.existing?.icon||''),
    scale:isMarker?Number($('#editScale').value||1):(pendingEdit.existing?.scale||1),
    opacity:isMarker?Number($('#editOpacity').value||100)/100:Number($('#editLineOpacity').value||100)/100,
    weight:isMarker?(pendingEdit.existing?.weight||3):Number($('#editLineWidth').value||4),
    radius:circleRadius,
    coords:pendingEdit.type==='circle'?[coords[0]]:coords
  };
  if(pendingEdit.existing){
    const i=annotations.findIndex(x=>x.id===pendingEdit.existing.id);if(i>=0)annotations[i]=item;
  }else annotations.push(item);
  saveAnnotations();renderAnnotations();closeModal();clearTemp();currentTool=null;$$('.tool').forEach(b=>b.classList.remove('active'));$('#cancelTool').disabled=true;$('#measurePanel').classList.add('hidden');
  const layer=annotationLayers.get(item.id);if(layer)fitLayer(layer);
  status(item.name+' salvo em Meus desenhos.');
}
function xmlEsc(v){return String(v??'').replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));}
function annotationsKml(){
  const items=annotations.map(a=>{
    const desc=a.note?'<description>'+xmlEsc(a.note)+'</description>':'';
    const alpha=Math.round(Math.max(.2,Math.min(1,Number(a.opacity??1)))*255).toString(16).padStart(2,'0');
    const kmlColor=alpha+(a.color||'#ff3b30').slice(1).match(/../g).reverse().join('');
    const style=a.type==='marker'
      ? '<Style><IconStyle><color>'+kmlColor+'</color><scale>'+(a.scale||1)+'</scale></IconStyle><LabelStyle><color>'+kmlColor+'</color></LabelStyle></Style>'
      : '<Style><LineStyle><color>'+kmlColor+'</color><width>'+(a.weight||4)+'</width></LineStyle><PolyStyle><color>55'+(a.color||'#ff3b30').slice(1).match(/../g).reverse().join('')+'</color></PolyStyle></Style>';
    let geom='';
    if(a.type==='marker'){
      const c=a.coords[0];geom='<Point><coordinates>'+c[1]+','+c[0]+',0</coordinates></Point>';
    }else if(a.type==='circle'){
      const poly=circlePolygon(a.coords?.[0]||[0,0],Number(a.radius||0));
      const coords=[...poly,poly[0]].map(c=>c[1]+','+c[0]+',0').join(' ');
      geom='<Polygon><outerBoundaryIs><LinearRing><coordinates>'+coords+'</coordinates></LinearRing></outerBoundaryIs></Polygon>';
    }else if(a.type==='area'){
      const coords=[...a.coords,a.coords[0]].map(c=>c[1]+','+c[0]+',0').join(' ');
      geom='<Polygon><outerBoundaryIs><LinearRing><coordinates>'+coords+'</coordinates></LinearRing></outerBoundaryIs></Polygon>';
    }else{
      geom='<LineString><tessellate>1</tessellate><coordinates>'+a.coords.map(c=>c[1]+','+c[0]+',0').join(' ')+'</coordinates></LineString>';
    }
    return '<Placemark><name>'+xmlEsc(a.name)+'</name>'+desc+style+geom+'</Placemark>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>GeoFoto - Meus desenhos</name>'+items+'</Document></kml>';
}
function downloadBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
async function exportKml(){downloadBlob(new Blob([annotationsKml()],{type:'application/vnd.google-earth.kml+xml'}),'geofoto-meus-desenhos.kml');}
async function exportKmz(){
  const zip=new JSZip();zip.file('doc.kml',annotationsKml());const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});downloadBlob(blob,'geofoto-meus-desenhos.kmz');
}




function loadRecentDestinations(){
  try{
    const v=JSON.parse(localStorage.getItem(NAV_RECENT_STORE)||'[]');
    return Array.isArray(v)?v.filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lng))).slice(0,8):[];
  }catch{return []}
}
function saveRecentDestinations(){
  try{localStorage.setItem(NAV_RECENT_STORE,JSON.stringify(recentDestinations.slice(0,8)))}catch{}
}
function rememberRecentDestination(target){
  if(!target)return;
  const item={lat:Number(target.lat),lng:Number(target.lng),name:String(target.name||'Destino'),source:String(target.source||'Localização'),usedAt:Date.now()};
  if(!Number.isFinite(item.lat)||!Number.isFinite(item.lng))return;
  recentDestinations=recentDestinations.filter(x=>L.latLng(x.lat,x.lng).distanceTo(L.latLng(item.lat,item.lng))>20);
  recentDestinations.unshift(item);recentDestinations=recentDestinations.slice(0,8);saveRecentDestinations();renderRecentDestinations();
}
function renderRecentDestinations(){
  const box=$('#driveRecent');if(!box)return;
  if(!recentDestinations.length){box.classList.add('hidden');box.innerHTML='';return}
  box.classList.remove('hidden');
  box.innerHTML='<div class="drive-recent-title">Recentes</div>'+recentDestinations.slice(0,5).map((x,i)=>'<button type="button" data-recent="'+i+'"><b>'+esc(x.name)+'</b><span>'+esc(x.source||'Destino')+'</span></button>').join('');
  box.querySelectorAll('[data-recent]').forEach(b=>b.onclick=()=>{
    const x=recentDestinations[Number(b.dataset.recent)];if(!x)return;
    setNavigationTarget(x.lat,x.lng,x.name,x.source||'Recente');startMeasuredNavigation();
  });
}
function loadNavVoicePreference(){
  try{return localStorage.getItem(NAV_VOICE_STORE)!=='0'}catch{return true}
}
function updateNavVoiceButtons(){
  if($('#navVoiceToggle'))$('#navVoiceToggle').textContent=navVoiceEnabled?'🔊 Voz':'🔇 Voz';
}
function toggleNavVoice(){
  navVoiceEnabled=!navVoiceEnabled;navLastSpokenKey='';
  try{localStorage.setItem(NAV_VOICE_STORE,navVoiceEnabled?'1':'0')}catch{}
  if(!navVoiceEnabled&&'speechSynthesis' in window)speechSynthesis.cancel();
  updateNavVoiceButtons();status(navVoiceEnabled?'Orientação por voz ativada.':'Orientação por voz desativada.');
}
function speakNavInstruction(text,key){
  if(!navVoiceEnabled||!text||!('speechSynthesis' in window)||key===navLastSpokenKey)return;
  navLastSpokenKey=key;
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);u.lang='pt-BR';u.rate=1;u.pitch=1;u.volume=1;
    speechSynthesis.speak(u);
  }catch{}
}
async function requestNavWakeLock(){
  if(navWakeLock||!('wakeLock' in navigator))return;
  try{
    navWakeLock=await navigator.wakeLock.request('screen');
    navWakeLock.addEventListener?.('release',()=>{navWakeLock=null});
  }catch{}
}
async function releaseNavWakeLock(){
  const lock=navWakeLock;navWakeLock=null;
  try{await lock?.release?.()}catch{}
}
function measuredDirectionsLink(){
  if(!measuredTarget)return '';
  return 'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(measuredTarget.lat+','+measuredTarget.lng)+'&travelmode=driving';
}
function openTargetInMaps(){
  const u=measuredDirectionsLink();if(u)window.open(u,'_blank','noopener');
}
async function shareCurrentTarget(){
  if(!measuredTarget)return;
  const text=(measuredTarget.name||'Destino')+'\nCoordenadas: '+Number(measuredTarget.lat).toFixed(6)+', '+Number(measuredTarget.lng).toFixed(6)+'\nRota: '+measuredDirectionsLink();
  try{
    if(navigator.share){await navigator.share({title:measuredTarget.name||'Destino',text});status('Destino pronto para compartilhar.');return}
    await navigator.clipboard.writeText(text);status('Destino e rota copiados.');
  }catch(e){if(e?.name!=='AbortError')prompt('Copie o destino:',text)}
}

function setNavigationTarget(lat,lng,name='Destino',source='Localização',extra={}){
  lat=Number(lat);lng=Number(lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return false;
  measuredTarget={lat,lng,name:name||'Destino',source,...extra};
  if(source==='Medição')lastMeasuredTarget={...measuredTarget};
  renderMeasuredTarget();
  return true;
}
function maneuverText(step){
  if(!step)return 'Siga pela rota';
  const m=step.maneuver||{},road=step.name?(' em '+step.name):'';
  const mod=String(m.modifier||'').toLowerCase(),type=String(m.type||'').toLowerCase();
  if(type==='arrive')return 'Você chegou ao destino';
  if(type==='depart')return step.name?('Siga por '+step.name):'Siga em frente';
  if(type.includes('roundabout')||type==='rotary')return 'Entre na rotatória'+road;
  if(type==='merge')return 'Entre na via'+road;
  if(type==='fork')return (mod.includes('left')?'Mantenha-se à esquerda':'Mantenha-se à direita')+road;
  if(type==='continue'||type==='new name')return 'Continue'+road;
  if(type==='turn'||type==='end of road'){
    if(mod.includes('uturn'))return 'Faça o retorno'+road;
    if(mod.includes('slight left'))return 'Vire levemente à esquerda'+road;
    if(mod.includes('sharp left'))return 'Vire forte à esquerda'+road;
    if(mod.includes('left'))return 'Vire à esquerda'+road;
    if(mod.includes('slight right'))return 'Vire levemente à direita'+road;
    if(mod.includes('sharp right'))return 'Vire forte à direita'+road;
    if(mod.includes('right'))return 'Vire à direita'+road;
    return 'Siga em frente'+road;
  }
  return step.name?('Siga por '+step.name):'Siga pela rota';
}
function routeDistanceBetween(startIdx,endIdx){
  if(!measuredRouteCoords?.length)return 0;
  startIdx=Math.max(0,Math.min(measuredRouteCoords.length-1,startIdx|0));
  endIdx=Math.max(startIdx,Math.min(measuredRouteCoords.length-1,endIdx|0));
  let sum=0;
  for(let i=startIdx+1;i<=endIdx;i++)sum+=L.latLng(measuredRouteCoords[i-1]).distanceTo(L.latLng(measuredRouteCoords[i]));
  return sum;
}
function buildRouteStepIndexes(){
  measuredRouteStepIndexes=(measuredRouteSteps||[]).map(step=>{
    const loc=step?.maneuver?.location;if(!loc||!measuredRouteCoords?.length)return 0;
    const ll=L.latLng(loc[1],loc[0]);let best=Infinity,idx=0;
    for(let i=0;i<measuredRouteCoords.length;i++){
      const d=ll.distanceTo(L.latLng(measuredRouteCoords[i]));
      if(d<best){best=d;idx=i}
    }
    return idx;
  });
}
function updateRouteInstruction(prog=routeProgressInfo()){
  const el=$('#targetInstruction');if(!el)return;
  if(!navigatingMeasuredTarget){el.textContent='--';return}
  if(!gpsLatLng||!measuredRouteSteps.length||!prog){el.textContent='Siga pela rota';return}
  if(prog.offRoute>35){
    const text='Entre na rota · '+fmtDistance(prog.offRoute);
    el.textContent=text;speakNavInstruction('Entre na rota.','offroute');
    return;
  }
  if(measuredFinalApproachDistance>12&&prog.remaining<=60){
    if(prog.remaining>15){
      const text=fmtDistance(prog.remaining)+' · pare no acesso mais próximo';
      el.textContent=text;speakNavInstruction('Atenção. Pare no acesso mais próximo.','approach-access');
    }else{
      const text='Acesso mais próximo · ponto a '+fmtDistance(measuredFinalApproachDistance);
      el.textContent=text;speakNavInstruction('Você chegou ao acesso mais próximo. O ponto fica a '+Math.round(measuredFinalApproachDistance)+' metros.','access-arrived');
    }
    return;
  }
  let chosenIndex=-1;
  for(let i=0;i<measuredRouteSteps.length;i++){
    const idx=measuredRouteStepIndexes[i]??0;
    if(idx>=Math.max(0,prog.bestIndex-1)){chosenIndex=i;break}
  }
  if(chosenIndex<0){el.textContent='Continue até o destino';speakNavInstruction('Continue até o destino.','finish');return}
  if(chosenIndex===0&&String(measuredRouteSteps[0]?.maneuver?.type||'').toLowerCase()==='depart'){
    const departIdx=measuredRouteStepIndexes[0]??0;
    if(routeDistanceBetween(prog.bestIndex,departIdx)<20&&measuredRouteSteps.length>1)chosenIndex=1;
  }
  const step=measuredRouteSteps[chosenIndex],stepIdx=measuredRouteStepIndexes[chosenIndex]??prog.bestIndex;
  const dist=routeDistanceBetween(prog.bestIndex,stepIdx),maneuver=maneuverText(step);
  el.textContent=(dist>18?fmtDistance(dist)+' · ':'')+maneuver;
  const spoken=(dist>25?'Em '+Math.max(10,Math.round(dist/10)*10)+' metros, ':'')+maneuver+'.';
  speakNavInstruction(spoken,'step-'+chosenIndex);
}
function renderDriveResultList(results,input,seq){
  if(seq!==driveSearchSeq)return false;
  const box=$('#driveSearchResults'),unique=[],seen=new Set();
  for(const r of results){
    if(!Number.isFinite(Number(r.lat))||!Number.isFinite(Number(r.lng)))continue;
    const k=Number(r.lat).toFixed(5)+','+Number(r.lng).toFixed(5);
    if(seen.has(k))continue;
    seen.add(k);unique.push(r);
    if(unique.length>=12)break;
  }
  if(!unique.length){box.classList.remove('hidden');box.innerHTML='<div class="drive-result-info">Nenhum destino encontrado.</div>';return false}
  box.classList.remove('hidden');
  box.innerHTML=unique.map((r,i)=>'<button type="button" data-drive-result="'+i+'"><b>'+esc(r.name)+'</b><span>'+esc(r.source)+'</span><small>'+Number(r.lat).toFixed(6)+', '+Number(r.lng).toFixed(6)+'</small></button>').join('');
  box.querySelectorAll('[data-drive-result]').forEach(b=>b.onclick=()=>{
    const r=unique[Number(b.dataset.driveResult)];if(!r)return;
    driveSearchSeq++;
    setNavigationTarget(r.lat,r.lng,r.name,r.source);
    box.classList.add('hidden');input.value=r.name;startMeasuredNavigation();
  });
  return true;
}

async function searchDriveDestination(){
  const input=$('#driveSearchInput'),box=$('#driveSearchResults'),raw=input.value.trim(),seq=++driveSearchSeq;
  if(!raw){box.classList.add('hidden');box.innerHTML='';return}
  box.classList.remove('hidden');box.innerHTML='<div class="drive-result-info">Buscando destino...</div>';
  const results=[];
  const coord=raw.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
  if(coord){
    const lat=Number(coord[1].replace(',','.')),lng=Number(coord[2].replace(',','.'));
    if(Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180)results.push({name:'Coordenadas '+lat.toFixed(6)+', '+lng.toFixed(6),lat,lng,source:'Coordenadas'});
  }
  const q=normalizeSearch(raw);
  if(q){
    const terms=q.split(' ').filter(Boolean);
    for(const item of searchIndex){
      const n=item.node;if(n?.type!=='placemark'||!n.pointLayer)continue;
      if(terms.every(t=>item.key.includes(t))){
        const ll=n.pointLayer.getLatLng();results.push({name:n.name||'Ponto do KMZ',lat:ll.lat,lng:ll.lng,source:n.source||'KMZ/KML'});
        if(results.length>=8)break;
      }
    }
    for(const a of annotations){
      if(a.type!=='marker')continue;
      const key=normalizeSearch((a.name||'')+' '+(a.note||''));
      if(terms.every(t=>key.includes(t))){
        results.push({name:a.name||'Marcador',lat:a.coords[0][0],lng:a.coords[0][1],source:'Meus desenhos'});
        if(results.length>=10)break;
      }
    }
    for(const p of projects){
      for(const item of projectItems(p.root,[])){
        const g=item.geometries?.[0];if(g?.type!=='Point'||!g.coords?.[0])continue;
        const key=normalizeSearch((item.name||'')+' '+(item.note||'')+' '+(p.name||''));
        if(terms.every(t=>key.includes(t))){
          const c=g.coords[0];results.push({name:item.name||'Ponto do projeto',lat:Number(c[0]),lng:Number(c[1]),source:'Projeto KMZ · '+p.name});
          if(results.length>=12)break;
        }
      }
      if(results.length>=12)break;
    }
  }
  if(results.length)renderDriveResultList(results,input,seq);
  try{
    const bias=gpsLatLng?'&lat='+gpsLatLng[0]+'&lon='+gpsLatLng[1]:'';
    const res=await fetch('/api/geocode?limit=6&q='+encodeURIComponent(raw)+bias,{cache:'no-store'});
    if(res.ok){
      const data=await res.json();
      for(const f of data?.features||[]){
        const c=f.geometry?.coordinates,p=f.properties||{};if(!c||c.length<2)continue;
        const a=p.address||{},city=a.city||a.town||a.village||a.municipality;
        let primary=p.name||a.road||p.street||'Endereço';
        if(a.house_number&&primary===a.road)primary+=', '+a.house_number;
        const label=[primary,a.suburb||a.neighbourhood,city,a.state].filter(Boolean).filter((v,i,x)=>x.indexOf(v)===i).join(' · ')||p.display_name||'Endereço';
        results.push({name:label,lat:Number(c[1]),lng:Number(c[0]),source:'Endereço'});
      }
    }
  }catch{}
  if(seq!==driveSearchSeq)return;
  renderDriveResultList(results,input,seq);
}
function useLastMeasuredTarget(){
  if(!lastMeasuredTarget){status('Ainda não há um ponto medido definido.');return}
  measuredTarget={...lastMeasuredTarget};renderMeasuredTarget();startMeasuredNavigation();
}
async function reverseDestinationName(lat,lng){
  try{
    const res=await fetch('/api/reverse?lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lng),{cache:'no-store'});
    if(!res.ok)return '';
    const data=await res.json(),f=data?.features?.[0],p=f?.properties||{};
    return [p.name,p.street,p.city,p.state].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ');
  }catch{return ''}
}
async function navigateToMapPoint(latlng){
  if(!latlng)return;
  drivePickDestination=false;status('Identificando o local escolhido...');
  const name=await reverseDestinationName(latlng.lat,latlng.lng);
  setNavigationTarget(latlng.lat,latlng.lng,name||'Local escolhido no mapa','Mapa');
  startMeasuredNavigation();
}
function beginDrivePickMap(){
  drivePickDestination=true;$('#driveSearchResults').classList.add('hidden');
  status('Toque no mapa no local que deseja usar como destino.');
}

function measuredTargetLink(){
  if(!measuredTarget)return '';
  return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(measuredTarget.lat+','+measuredTarget.lng);
}
function renderMeasuredTarget(){
  const info=$('#measuredTargetInfo'),has=!!measuredTarget;
  $('#shareMeasuredTarget').disabled=!has;$('#navigateMeasuredTarget').disabled=!has;$('#openMeasuredTargetMaps').disabled=!has;$('#clearMeasuredTarget').disabled=!has;
  if(!has){info.classList.add('hidden');info.innerHTML='';$('#targetHud').classList.add('hidden');return}
  info.classList.remove('hidden');
  info.innerHTML='<b>'+esc(measuredTarget.name||'Destino')+'</b><span>'+esc(measuredTarget.source||'Localização')+' · '+measuredTarget.lat.toFixed(6)+', '+measuredTarget.lng.toFixed(6)+'</span>';
  $('#targetTitle').textContent=(measuredTarget.name||'DESTINO').toUpperCase();
  $('#targetCoords').textContent=measuredTarget.lat.toFixed(6)+', '+measuredTarget.lng.toFixed(6);
  if(measuredTargetMarker&&map.hasLayer(measuredTargetMarker))map.removeLayer(measuredTargetMarker);
  const icon=L.divIcon({className:'measured-target-icon',html:'<div>⚑</div>',iconSize:[34,42],iconAnchor:[17,38]});
  measuredTargetMarker=L.marker([measuredTarget.lat,measuredTarget.lng],{icon,zIndexOffset:3500}).addTo(map);
  measuredTargetMarker.bindTooltip(measuredTarget.name||'Destino',{permanent:true,direction:'right',offset:[10,0],className:'measured-target-label'});
  updateMeasuredNavigation();
}
function clearMeasuredTarget(){
  navigatingMeasuredTarget=false;clearMeasuredRoute();document.body.classList.remove('route-active');navLastSpokenKey='';
  if('speechSynthesis' in window)speechSynthesis.cancel();releaseNavWakeLock();
  if(measuredTargetMarker&&map.hasLayer(measuredTargetMarker))map.removeLayer(measuredTargetMarker);
  measuredTargetMarker=null;measuredTarget=null;
  $('#targetHud').classList.add('hidden');$('#targetDistance').textContent='--';$('#targetCoords').textContent='--';$('#targetRouteInfo').textContent='Calculando rota...';$('#targetInstruction').textContent='--';
  if($('#driveSearchInput'))$('#driveSearchInput').value='';
  if(driving){$('#driveSearchPanel').classList.remove('hidden');renderRecentDestinations()}
  renderMeasuredTarget();status('Destino removido. Você pode escolher outro local.');
}
function setMeasuredTargetFromEnd(){
  if(tempPoints.length<2){alert('Faça a medição com pelo menos dois pontos primeiro.');return}
  const end=tempPoints[tempPoints.length-1];
  const name=prompt('Nome do ponto de destino:','Ponto medido')||'Ponto medido';
  setNavigationTarget(end[0],end[1],name,'Medição',{measuredDistance:distanceOf(tempPoints)});
  map.setView([measuredTarget.lat,measuredTarget.lng],Math.max(map.getZoom(),17));
  status('Destino definido no ponto final da medição.');
}
async function shareMeasuredLocation(){
  if(!measuredTarget)return;
  const extra=Number.isFinite(measuredTarget.measuredDistance)?('\nDistância medida: '+fmtDistance(measuredTarget.measuredDistance)):'';
  const text=(measuredTarget.name||'Destino')+'\nCoordenadas: '+measuredTarget.lat.toFixed(6)+', '+measuredTarget.lng.toFixed(6)+extra+'\n'+measuredTargetLink();
  try{
    if(navigator.share){await navigator.share({title:measuredTarget.name||'Ponto medido',text});status('Localização pronta para compartilhar.');return}
    await navigator.clipboard.writeText(text);alert('Localização copiada. Agora você pode colar no WhatsApp, Telegram ou outro aplicativo.');
  }catch(e){if(e?.name!=='AbortError')alert('Não foi possível compartilhar automaticamente.\n\n'+text)}
}
function openMeasuredInMaps(){
  const u=measuredDirectionsLink();if(u)window.open(u,'_blank','noopener');
}
function formatDuration(sec){
  sec=Number(sec)||0;
  const min=Math.max(1,Math.round(sec/60));
  if(min<60)return min+' min';
  const h=Math.floor(min/60),m=min%60;
  return h+' h'+(m?' '+m+' min':'');
}
function clearMeasuredRoute(){
  for(const layer of [measuredTargetLine,measuredRouteConnector,measuredFinalApproachLine]){
    if(layer&&map.hasLayer(layer))map.removeLayer(layer);
  }
  measuredTargetLine=null;measuredRouteConnector=null;measuredFinalApproachLine=null;
  measuredRouteCoords=null;measuredRouteDistance=null;measuredRouteDuration=null;measuredRouteSteps=[];measuredRouteStepIndexes=[];
  measuredRouteStartSnap=null;measuredRouteEndSnap=null;measuredFinalApproachDistance=0;lastRouteProgressIndex=0;measuredRouteRetryAt=0;
}
function routeInfoText(remaining,remainingDuration){
  const pieces=['Pelas ruas'];
  if(Number.isFinite(remainingDuration)&&remainingDuration>0){
    pieces.push(formatDuration(remainingDuration));
    const eta=new Date(Date.now()+remainingDuration*1000).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    pieces.push('chegada '+eta);
  }
  if(measuredFinalApproachDistance>12)pieces.push('+'+fmtDistance(measuredFinalApproachDistance)+' até o ponto');
  return pieces.join(' · ');
}
function updateRouteVisual(prog){
  if(!prog||!measuredRouteCoords?.length)return;
  const start=Math.max(0,prog.bestIndex-1),remaining=measuredRouteCoords.slice(start);
  if(measuredTargetLine&&map.hasLayer(measuredTargetLine)){
    measuredTargetLine.setLatLngs(remaining);
  }else{
    measuredTargetLine=L.polyline(remaining,{color:'#00c8ff',weight:7,opacity:.95,interactive:false}).addTo(map);
  }
  measuredTargetLine.bringToFront?.();
  const routePoint=measuredRouteCoords[prog.bestIndex];
  if(prog.offRoute>18&&routePoint){
    const connector=[gpsLatLng,routePoint];
    if(measuredRouteConnector&&map.hasLayer(measuredRouteConnector))measuredRouteConnector.setLatLngs(connector);
    else measuredRouteConnector=L.polyline(connector,{color:'#ffd54a',weight:4,opacity:.9,dashArray:'8 7',interactive:false}).addTo(map);
  }else if(measuredRouteConnector&&map.hasLayer(measuredRouteConnector)){
    map.removeLayer(measuredRouteConnector);measuredRouteConnector=null;
  }
  if(measuredRouteEndSnap&&measuredFinalApproachDistance>12){
    const finalLine=[measuredRouteEndSnap,[measuredTarget.lat,measuredTarget.lng]];
    if(measuredFinalApproachLine&&map.hasLayer(measuredFinalApproachLine))measuredFinalApproachLine.setLatLngs(finalLine);
    else measuredFinalApproachLine=L.polyline(finalLine,{color:'#ff9f43',weight:4,opacity:.95,dashArray:'6 7',interactive:false}).addTo(map);
  }else if(measuredFinalApproachLine&&map.hasLayer(measuredFinalApproachLine)){
    map.removeLayer(measuredFinalApproachLine);measuredFinalApproachLine=null;
  }
}

function bearingBetween(a,b){
  if(!a||!b)return 0;
  const lat1=a[0]*Math.PI/180,lat2=b[0]*Math.PI/180,dLon=(b[1]-a[1])*Math.PI/180;
  const y=Math.sin(dLon)*Math.cos(lat2);
  const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
function routeHeading(prog=routeProgressInfo()){
  if(!prog||!measuredRouteCoords?.length)return gpsHeading||0;
  const a=measuredRouteCoords[prog.bestIndex],b=measuredRouteCoords[Math.min(measuredRouteCoords.length-1,prog.bestIndex+5)];
  return bearingBetween(a,b);
}

function navigationCameraCenter(prog){
  if(!gpsLatLng||!prog||!measuredRouteCoords?.length)return gpsLatLng;
  let ahead=measuredRouteCoords[Math.min(measuredRouteCoords.length-1,prog.bestIndex+1)],walked=0;
  for(let i=prog.bestIndex+1;i<measuredRouteCoords.length;i++){
    walked+=L.latLng(measuredRouteCoords[i-1]).distanceTo(L.latLng(measuredRouteCoords[i]));
    ahead=measuredRouteCoords[i];
    if(walked>=180)break;
  }
  if(!ahead)return gpsLatLng;
  return [gpsLatLng[0]*.68+ahead[0]*.32,gpsLatLng[1]*.68+ahead[1]*.32];
}
async function requestMeasuredRoadRoute(force=false){
  if(!navigatingMeasuredTarget||!measuredTarget||!gpsLatLng||measuredRouteLoading)return;
  const now=Date.now();
  if(!force&&now<measuredRouteRetryAt)return;
  const moved=measuredRouteLastFrom?L.latLng(gpsLatLng).distanceTo(L.latLng(measuredRouteLastFrom)):Infinity;
  if(force&&measuredRouteCoords&&(now-measuredRouteLastAt)<12000)return;
  if(!force&&measuredRouteCoords&&moved<100&&(now-measuredRouteLastAt)<35000)return;
  measuredRouteLoading=true;
  $('#targetRouteInfo').textContent='Calculando rota pelas ruas...';
  try{
    const url='/api/route?fromLat='+encodeURIComponent(gpsLatLng[0])+'&fromLng='+encodeURIComponent(gpsLatLng[1])+'&toLat='+encodeURIComponent(measuredTarget.lat)+'&toLng='+encodeURIComponent(measuredTarget.lng);
    const res=await fetch(url,{cache:'no-store'});
    if(!res.ok)throw new Error('rota indisponível');
    const data=await res.json(),route=data?.routes?.[0];
    if(!route?.geometry?.coordinates?.length)throw new Error('rota não encontrada');
    measuredRouteCoords=route.geometry.coordinates.map(c=>[c[1],c[0]]);
    measuredRouteDistance=Number(route.distance)||null;
    measuredRouteDuration=Number(route.duration)||null;
    measuredRouteSteps=route?.legs?.[0]?.steps||[];
    measuredRouteRetryAt=0;if(force)navLastSpokenKey='';
    const wp0=data?.waypoints?.[0]?.location,wp1=data?.waypoints?.[1]?.location;
    measuredRouteStartSnap=wp0?[Number(wp0[1]),Number(wp0[0])]:measuredRouteCoords[0];
    measuredRouteEndSnap=wp1?[Number(wp1[1]),Number(wp1[0])]:measuredRouteCoords[measuredRouteCoords.length-1];
    measuredFinalApproachDistance=measuredRouteEndSnap?L.latLng(measuredRouteEndSnap).distanceTo(L.latLng(measuredTarget.lat,measuredTarget.lng)):0;
    lastRouteProgressIndex=0;buildRouteStepIndexes();
    measuredRouteLastFrom=[...gpsLatLng];measuredRouteLastAt=now;
    const prog=routeProgressInfo();
    updateRouteVisual(prog);
    if(prog&&driving&&followGps){
      const camera=navigationCameraCenter(prog);
      map.setView(camera,lastGpsSpeedKmh>=60?16:lastGpsSpeedKmh>=25?17:18,{animate:true});
    }
    $('#targetDistance').textContent=prog?.remaining?fmtDistance(prog.remaining):measuredRouteDistance?fmtDistance(measuredRouteDistance):'--';
    $('#targetRouteInfo').textContent=routeInfoText(measuredRouteDistance,measuredRouteDuration);
    updateRouteInstruction(prog);
  }catch(e){
    measuredRouteRetryAt=Date.now()+15000;
    if(measuredRouteCoords?.length>1){
      const prog=routeProgressInfo();
      if(prog){
        updateRouteVisual(prog);
        $('#targetDistance').textContent=fmtDistance(prog.remaining+Math.max(0,measuredFinalApproachDistance||0));
        $('#targetRouteInfo').textContent='Sem conexão para recalcular · mantendo rota atual';
        updateRouteInstruction(prog);
      }
    }else{
      clearMeasuredRoute();measuredRouteRetryAt=Date.now()+15000;
      const direct=L.latLng(gpsLatLng).distanceTo(L.latLng(measuredTarget.lat,measuredTarget.lng));
      $('#targetDistance').textContent=fmtDistance(direct);
      $('#targetRouteInfo').textContent='Sem rota viária · distância em linha reta';$('#targetInstruction').textContent='Abra no Maps para uma rota alternativa';
    }
  }finally{measuredRouteLoading=false}
}

function routeProgressInfo(){
  if(!gpsLatLng||!measuredRouteCoords?.length)return null;
  const n=measuredRouteCoords.length;
  let start=Math.max(0,lastRouteProgressIndex-6),end=Math.min(n-1,lastRouteProgressIndex?lastRouteProgressIndex+260:Math.max(120,Math.floor(n*.15)));
  let best=Infinity,bestIndex=lastRouteProgressIndex;
  for(let i=start;i<=end;i++){
    const d=L.latLng(gpsLatLng).distanceTo(L.latLng(measuredRouteCoords[i]));
    if(d<best){best=d;bestIndex=i}
  }
  if(best>160){
    let globalBest=Infinity,globalIndex=bestIndex;
    const step=Math.max(1,Math.floor(n/700));
    for(let i=0;i<n;i+=step){
      const d=L.latLng(gpsLatLng).distanceTo(L.latLng(measuredRouteCoords[i]));
      if(d<globalBest){globalBest=d;globalIndex=i}
    }
    if(globalBest<best*.55){best=globalBest;bestIndex=globalIndex}
  }
  if(bestIndex<lastRouteProgressIndex-3)bestIndex=lastRouteProgressIndex;
  lastRouteProgressIndex=Math.max(lastRouteProgressIndex,bestIndex);
  bestIndex=lastRouteProgressIndex;
  best=L.latLng(gpsLatLng).distanceTo(L.latLng(measuredRouteCoords[bestIndex]));
  let remaining=best+routeDistanceBetween(bestIndex,n-1);
  return {offRoute:best,remaining,bestIndex};
}

function updateMeasuredNavigation(){
  if(!measuredTarget)return;
  const hud=$('#targetHud');
  if(!navigatingMeasuredTarget){hud.classList.add('hidden');return}
  hud.classList.remove('hidden');
  if(gpsLatLng){
    const direct=L.latLng(gpsLatLng).distanceTo(L.latLng(measuredTarget.lat,measuredTarget.lng));
    const prog=routeProgressInfo();
    if(prog){
      updateRouteVisual(prog);
      const totalRemaining=prog.remaining+Math.max(0,measuredFinalApproachDistance||0);
      $('#targetDistance').textContent=fmtDistance(totalRemaining);
      const ratio=measuredRouteDistance?Math.max(0,Math.min(1,prog.remaining/measuredRouteDistance)):1;
      $('#targetRouteInfo').textContent=routeInfoText(prog.remaining,measuredRouteDuration?measuredRouteDuration*ratio:null);
      updateRouteInstruction(prog);
      if(driving&&followGps){
        const camera=navigationCameraCenter(prog);
        const navZoom=lastGpsSpeedKmh>=60?16:lastGpsSpeedKmh>=25?17:18;
        map.setView(camera,navZoom,{animate:true});
      }
    }else if(measuredRouteDistance)$('#targetDistance').textContent=fmtDistance(measuredRouteDistance);
    else{
      $('#targetDistance').textContent='Calculando...';
      if(driving&&followGps)map.setView(gpsLatLng,lastGpsSpeedKmh>=60?16:lastGpsSpeedKmh>=25?17:18,{animate:true});
    }
    const gpsReliable=lastGpsAccuracy===null||lastGpsAccuracy<=35;
    if(direct<=25&&gpsReliable){
      $('#targetInstruction').textContent='Você chegou ao destino';
      speakNavInstruction('Você chegou ao destino.','arrived');
      status('Você chegou a '+(measuredTarget.name||'seu destino')+'.');
    }else if(prog&&prog.offRoute>75&&(lastGpsAccuracy===null||lastGpsAccuracy<=60))requestMeasuredRoadRoute(true);
    else requestMeasuredRoadRoute(false);
  }else{
    $('#targetDistance').textContent='Aguardando GPS';
    $('#targetRouteInfo').textContent='Aguardando sua posição...';
    $('#targetInstruction').textContent='Aguardando GPS';
  }
}
function prepareNavigationMode(){
  closeImportedPanel();
  if(currentTool==='import-edit')cancelImportedLineEdit();
  else if(currentTool){
    clearTemp();currentTool=null;
    $$('.tool').forEach(b=>b.classList.remove('active'));
    $('#cancelTool').disabled=true;$('#measurePanel').classList.add('hidden');
    $('#toolHelp').textContent='Escolha uma ferramenta e toque no mapa.';
  }
}
function startMeasuredNavigation(){
  if(!measuredTarget)return;
  prepareNavigationMode();
  if(isMobileUi())closeMobileSheet();
  navigatingMeasuredTarget=true;driving=true;followGps=true;navLastSpokenKey='';
  document.body.classList.add('drive','route-active');
  $('#btnDrive').textContent='⏹ Sair condução';
  $('#driveSearchPanel').classList.add('hidden');
  $('#driveSearchResults').classList.add('hidden');
  syncMobileNav();updateNavVoiceButtons();rememberRecentDestination(measuredTarget);requestNavWakeLock();
  measuredRouteLastFrom=null;measuredRouteLastAt=0;clearMeasuredRoute();
  if(watchId===null)startGps();
  if(gpsLatLng){map.setView(gpsLatLng,17,{animate:true});requestMeasuredRoadRoute(true)}
  updateMeasuredNavigation();
  status('Navegação iniciada para '+(measuredTarget.name||'o destino')+'.');
}
function stopMeasuredNavigation(){
  navigatingMeasuredTarget=false;clearMeasuredRoute();document.body.classList.remove('route-active');navLastSpokenKey='';
  if('speechSynthesis' in window)speechSynthesis.cancel();releaseNavWakeLock();
  $('#targetHud').classList.add('hidden');$('#targetInstruction').textContent='--';
  if(driving){$('#driveSearchPanel').classList.remove('hidden');renderRecentDestinations()}
  status('Navegação encerrada. Escolha outro destino ou saia do modo condução.');
}
function changeNavigationTarget(){
  if(navigatingMeasuredTarget)stopMeasuredNavigation();
  driving=true;followGps=true;document.body.classList.add('drive');
  $('#driveSearchPanel').classList.remove('hidden');$('#driveSearchResults').classList.add('hidden');
  $('#driveSearchInput').focus();status('Digite ou escolha o novo destino.');
}

function startGps(){
  if(!navigator.geolocation){alert('Este navegador não oferece GPS.');return}
  if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null;$('#btnGps').textContent='📍 GPS';$('#gpsHud').classList.add('hidden');if(navigatingMeasuredTarget)stopMeasuredNavigation();status('GPS pausado.');return}
  $('#btnGps').textContent='⏹ Parar GPS';$('#gpsHud').classList.remove('hidden');status('Aguardando posição GPS...');
  watchId=navigator.geolocation.watchPosition(pos=>{
    const {latitude,longitude,accuracy,speed,heading}=pos.coords;
    gpsLatLng=[latitude,longitude];lastGpsAccuracy=Number.isFinite(accuracy)?Number(accuracy):null;lastGpsSpeedKmh=Number.isFinite(speed)?Math.max(0,speed*3.6):0;
    if(Number.isFinite(heading)&&Number(speed||0)>.7)gpsHeading=heading;
    else if(navigatingMeasuredTarget&&measuredRouteCoords?.length)gpsHeading=routeHeading();
    const html='<div class="gps-arrow" style="transform:rotate('+gpsHeading+'deg)">▲</div>';
    const icon=L.divIcon({className:'',html,iconSize:[28,28],iconAnchor:[14,14]});
    if(!gpsMarker)gpsMarker=L.marker(gpsLatLng,{icon,zIndexOffset:2000}).addTo(map);
    else{gpsMarker.setLatLng(gpsLatLng);gpsMarker.setIcon(icon)}
    $('#gpsSpeed').textContent=Number.isFinite(speed)?lastGpsSpeedKmh.toFixed(0)+' km/h':'--';
    const lowAccuracy=Number(accuracy||0)>30;
    $('#gpsAccuracy').textContent=(lowAccuracy?'⚠ ':'')+'± '+Math.round(accuracy||0)+' m';
    $('#gpsHud').classList.toggle('gps-warning',lowAccuracy);
    $('#gpsCoords').textContent=latitude.toFixed(6)+', '+longitude.toFixed(6);
    updateMeasuredNavigation();
    if((followGps||driving)&&!navigatingMeasuredTarget)map.setView(gpsLatLng,Math.max(map.getZoom(),16),{animate:true});
    if(!navigatingMeasuredTarget)status('GPS ativo · precisão ± '+Math.round(accuracy||0)+' m');
  },err=>{status('GPS indisponível: '+err.message);alert('Não foi possível obter a localização: '+err.message)},{
    enableHighAccuracy:true,maximumAge:1000,timeout:15000
  });
}
function centerOnGps(){
  if(!gpsLatLng){status('Ative o GPS e aguarde a posição.');return}
  followGps=true;map.setView(gpsLatLng,17,{animate:true});status('Acompanhamento da posição ativado.');
}
function toggleDrive(){
  driving=!driving;followGps=driving||followGps;document.body.classList.toggle('drive',driving);
  $('#btnDrive').textContent=driving?'⏹ Sair condução':'🚗 Modo condução';
  $('#driveSearchPanel').classList.toggle('hidden',!driving);
  drivePickDestination=false;
  if(driving){
    prepareNavigationMode();
    renderRecentDestinations();updateNavVoiceButtons();
    if(watchId===null)startGps();
    if(gpsLatLng)map.setView(gpsLatLng,17);
    setTimeout(()=>$('#driveSearchInput')?.focus(),100);
    status('Modo condução ativo. Digite um endereço, procure um ponto do KMZ ou escolha no mapa.');
  }else{
    if(navigatingMeasuredTarget)stopMeasuredNavigation();
    document.body.classList.remove('route-active');
    $('#driveSearchPanel').classList.add('hidden');$('#driveSearchResults').classList.add('hidden');followGps=false;releaseNavWakeLock();
    if('speechSynthesis' in window)speechSynthesis.cancel();
    status('Modo condução encerrado.');
  }
  syncMobileNav();
  setTimeout(()=>map.invalidateSize(),120);
}

map.on('dragstart',()=>{followGps=false;if(driving)status('Mapa livre. Toque em ◎ para voltar a acompanhar o veículo.')});
map.on('zoomstart',()=>{if(!driving)followGps=false});
map.on('moveend zoomend',refreshPointLabels);
map.on('mousemove',e=>updateCoordHud(e.latlng));
map.on('click',e=>{
  hideMapContextMenu();updateCoordHud(e.latlng);
  if(drivePickDestination){
    navigateToMapPoint(e.latlng);return;
  }
  if(!currentTool){const hits=findImportedAt(e.latlng);if(hits.length===1)showImportedFeature(hits[0].node);else if(hits.length>1)showImportedChoices(hits);return}
  if(currentTool==='import-edit'){insertTempVertex(e.latlng);return}
  const c=[e.latlng.lat,e.latlng.lng];
  if(currentTool==='marker'){openEditModal('marker',[c]);return}
  if(currentTool==='circle'&&tempPoints.length>=2){tempPoints[1]=c;redrawTemp();return}
  tempPoints.push(c);redrawTemp();
});
map.on('dblclick',e=>{
  if((currentTool==='trace'&&tempPoints.length>=2)||(currentTool==='area'&&tempPoints.length>=3)){L.DomEvent.stop(e);finishCurrent()}
});


function isMobileUi(){return window.matchMedia('(max-width:820px)').matches}
function mobileSheetTitle(tab){
  return ({layers:'Camadas e arquivos',tools:'Ferramentas',projects:'Projetos KMZ'})[tab]||'GeoFoto';
}
function syncMobileNav(tab){
  const activeTab=tab||document.querySelector('.tab.active')?.dataset.tab||'layers';
  $$('#mobileNav [data-mobile-tab]').forEach(b=>b.classList.toggle('active',!driving&&b.dataset.mobileTab===activeTab));
  $('#mobileNav [data-mobile-action="drive"]')?.classList.toggle('active',driving);
  if($('#mobileSheetTitle'))$('#mobileSheetTitle').textContent=mobileSheetTitle(activeTab);
}
function closeMobileSheet(){
  document.body.classList.remove('mobile-sheet-open');
  setTimeout(()=>map.invalidateSize(),230);
}
function openMobileSheet(tab){
  if(!isMobileUi())return;
  document.body.classList.add('mobile-sheet-open');
  const heights={layers:'58dvh',tools:'52dvh',projects:'62dvh'};
  document.documentElement.style.setProperty('--mobile-sheet-height',heights[tab]||'56dvh');
  syncMobileNav(tab);
  setTimeout(()=>map.invalidateSize(),230);
}
function activateSidebarTab(tab,{openMobile=true}={}){
  if(currentTool&&tab!=='tools'){status('Finalize ou cancele a ferramenta atual para sair de Ferramentas.');if(isMobileUi())openMobileSheet('tools');return false}
  $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));
  $$('.tab-panel').forEach(x=>x.classList.toggle('active',x.id==='tab-'+tab));
  if(openMobile&&isMobileUi())openMobileSheet(tab);else syncMobileNav(tab);
  return true;
}
function setupMobileSheetDrag(){
  const grip=$('#mobileSheetGrip'),side=$('#sidebar');if(!grip||!side)return;
  let startY=0,startH=0,dragging=false,moved=false;
  grip.onpointerdown=e=>{
    if(!isMobileUi())return;
    dragging=true;moved=false;startY=e.clientY;startH=side.getBoundingClientRect().height;grip.setPointerCapture?.(e.pointerId);
    document.body.classList.add('mobile-sheet-dragging');e.preventDefault();
  };
  grip.onpointermove=e=>{
    if(!dragging)return;
    if(Math.abs(e.clientY-startY)>7)moved=true;
    const max=window.innerHeight-76,min=180,next=Math.max(min,Math.min(max,startH+(startY-e.clientY)));
    document.documentElement.style.setProperty('--mobile-sheet-height',next+'px');
  };
  const done=e=>{if(!dragging)return;dragging=false;document.body.classList.remove('mobile-sheet-dragging');grip.releasePointerCapture?.(e.pointerId);setTimeout(()=>map.invalidateSize(),30)};
  grip.onpointerup=done;grip.onpointercancel=done;
  grip.onclick=()=>{
    if(!isMobileUi())return;
    if(moved){moved=false;return}
    const h=side.getBoundingClientRect().height,win=window.innerHeight;
    const next=h<win*.5?'72dvh':h<win*.8?'91dvh':'52dvh';
    document.documentElement.style.setProperty('--mobile-sheet-height',next);
  };
}

$$('.tab').forEach(b=>b.onclick=()=>activateSidebarTab(b.dataset.tab));
$$('.tool').forEach(b=>b.onclick=()=>{setTool(b.dataset.tool);if(isMobileUi())document.documentElement.style.setProperty('--mobile-sheet-height','44dvh')});
$('#undoPoint').onclick=()=>{if(tempPoints.length){tempPoints.pop();redrawTemp()}};
$('#finishTool').onclick=finishCurrent;
$('#cancelTool').onclick=()=>{if(currentTool==='import-edit')return cancelImportedLineEdit();clearTemp();setTool(null);status('Ferramenta cancelada.')} ;
$('#saveMeasurement').onclick=()=>{if(currentTool==='area'&&tempPoints.length>=3)return openEditModal('area',[...tempPoints]);if(tempPoints.length>=2)openEditModal(currentTool==='circle'?'circle':'measure',[...tempPoints])};
$('#clearMeasurement').onclick=()=>{clearTemp();status('Medição limpa.')};
$('#setMeasuredTarget').onclick=setMeasuredTargetFromEnd;
$('#shareMeasuredTarget').onclick=shareMeasuredLocation;
$('#navigateMeasuredTarget').onclick=startMeasuredNavigation;
$('#openMeasuredTargetMaps').onclick=openMeasuredInMaps;
$('#clearMeasuredTarget').onclick=clearMeasuredTarget;
$('#stopTargetNavigation').onclick=stopMeasuredNavigation;
$('#changeTargetNavigation').onclick=changeNavigationTarget;
$('#navVoiceToggle').onclick=toggleNavVoice;
$('#shareTargetNavigation').onclick=shareCurrentTarget;
$('#openTargetMaps').onclick=openTargetInMaps;
$('#driveSearchBtn').onclick=searchDriveDestination;
$('#driveSearchInput').oninput=()=>{clearTimeout(driveSearchTimer);driveSearchTimer=setTimeout(searchDriveDestination,650)};
$('#driveSearchInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchDriveDestination()}};
$('#driveMeasuredTarget').onclick=useLastMeasuredTarget;
$('#drivePickMap').onclick=beginDrivePickMap;

$$('#iconPalette [data-icon]').forEach(b=>b.onclick=()=>{$('#editIcon').value=b.dataset.icon;refreshIconPalette()});
$('#editScale').oninput=refreshIconPalette;$('#editOpacity').oninput=refreshIconPalette;
$('#editLineWidth').oninput=()=>$('#lineWidthValue').textContent=$('#editLineWidth').value+' px';
$('#editLineOpacity').oninput=()=>$('#lineOpacityValue').textContent=$('#editLineOpacity').value+'%';
$('#measureUnit').onchange=()=>updateTempGeometry();
$('#coordHudText').onclick=()=>{coordFormat=coordFormat==='dec'?'dms':'dec';if(lastMapCoord)updateCoordHud(L.latLng(lastMapCoord[0],lastMapCoord[1]))};
$('#copyCoordHud').onclick=()=>{if(lastMapCoord)copyText(lastMapCoord[0].toFixed(6)+', '+lastMapCoord[1].toFixed(6),'Coordenadas copiadas.')};
$('#editForm').onsubmit=e=>{e.preventDefault();saveModal()};
$('#modalCancel').onclick=closeModal;$('#closeModal').onclick=closeModal;
$('#modal').onclick=e=>{if(e.target===$('#modal'))closeModal()};

$('#fileInput').onchange=async e=>{await loadFiles([...e.target.files]);e.target.value=''};
$('#searchInput').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderSearchResults,160)};
$('#clearSearch').onclick=()=>{$('#searchInput').value='';renderSearchResults();$('#searchInput').focus()};
function changeBaseMap(value){
  if(!bases[value])return;
  map.removeLayer(activeBase);activeBase=bases[value];activeBase.addTo(map);
  $('#baseMap').value=value;if($('#mobileBaseMap'))$('#mobileBaseMap').value=value;
  if(gpsMarker)gpsMarker.bringToFront?.();
  const label=$('#baseMap').selectedOptions?.[0]?.text||value;status('Mapa base: '+label);
}
$('#baseMap').onchange=e=>changeBaseMap(e.target.value);
$('#mobileBaseMap').onchange=e=>changeBaseMap(e.target.value);
$('#btnGps').onclick=startGps;$('#centerGps').onclick=centerOnGps;$('#btnDrive').onclick=toggleDrive;
$('#mobileSheetClose').onclick=closeMobileSheet;
$$('#mobileNav [data-mobile-tab]').forEach(b=>b.onclick=()=>{
  const tab=b.dataset.mobileTab,active=document.querySelector('.tab.active')?.dataset.tab;
  if(document.body.classList.contains('mobile-sheet-open')&&active===tab){closeMobileSheet();return}
  activateSidebarTab(tab);
});
$('#mobileNav [data-mobile-action="drive"]').onclick=()=>{
  if(currentTool){
    const hasDraft=currentTool==='import-edit'||tempPoints.length>0;
    if(hasDraft&&!confirm('Há uma medição ou edição em andamento. Deseja descartá-la e abrir a navegação?')){activateSidebarTab('tools');return}
    prepareNavigationMode();
  }
  closeMobileSheet();toggleDrive();syncMobileNav();
};
$('#toggleSidebar').onclick=()=>{document.querySelector('.layout').classList.toggle('sidebar-hidden');setTimeout(()=>map.invalidateSize(),120)};
$('#exportKml').onclick=exportKml;$('#exportKmz').onclick=exportKmz;
$('#newProject').onclick=createProject;$('#newProjectFolder').onclick=createProjectFolder;$('#renameProject').onclick=renameActiveProject;$('#deleteProject').onclick=deleteActiveProject;
$('#projectSelect').onchange=e=>{activeProjectId=e.target.value;selectedProjectNodeId='';saveProjects();renderProjects()};
$('#projectPreview').onchange=()=>renderProjectMap();
$('#addSelectedToProject').onclick=addSelectedImportedToProject;$('#addDrawingToProject').onclick=addDrawingSavedToProject;
$('#exportProjectKml').onclick=exportActiveProjectKml;$('#exportProjectKmz').onclick=exportActiveProjectKmz;

map.on('contextmenu',e=>{if(e.originalEvent?._gfFeatureMenu)return;if(driving){navigateToMapPoint(e.latlng)}else showMapContextMenu(e.latlng,e.containerPoint)});
map.on('movestart zoomstart',hideMapContextMenu);
map.getContainer().addEventListener('contextmenu',e=>e.preventDefault());
setupMobileSheetDrag();
window.addEventListener('resize',()=>{if(!isMobileUi())document.body.classList.remove('mobile-sheet-open');syncMobileNav();setTimeout(()=>map.invalidateSize(),80)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&navigatingMeasuredTarget)requestNavWakeLock()});
if(EMBEDDED_NAV&&$('#backToGeoFoto'))$('#backToGeoFoto').onclick=()=>window.parent.postMessage({type:'geofoto:navigation:back'},location.origin);
else $('#backToGeoFoto')?.remove();
initIconPalette();renderAnnotations();renderLayerTree();renderProjects();syncMobileNav();updateNavVoiceButtons();renderRecentDestinations();hydrateProjectsDb();
if(isMobileUi())closeMobileSheet();
setTimeout(()=>map.invalidateSize(),100);
status('GeoFoto Navegação pronto. KMZ/KML são lidos localmente neste navegador.');
})();