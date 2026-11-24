'use strict';
(()=>{
  const C=window.inspectionCatalog, records=window.inspectionRecords;
  const byId=id=>document.getElementById(id);
  if(!window.L||!C||!records||typeof DecompressionStream==='undefined'){
    byId('map-status').textContent='The interactive needs a current browser and the complete map folder. The CSV files below are available.';
    return;
  }
  const fmt=n=>n.toLocaleString('en-US'), esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const areas=new Map(C.areas.map(a=>[a[0],a])), names=ids=>ids.map(id=>areas.get(id)?.[1]||id).join(', ');
  const origin=L.point(C.origin);
  const geo=(x,y)=>L.CRS.EPSG3857.pointToLatLng(L.point(x,y).add(origin),20);
  const bounds=b=>L.latLngBounds(geo(b[0],b[1]),geo(b[2],b[3]));
  const intersects=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
  const map=L.map('map',{minZoom:8,maxZoom:20,zoomAnimation:false,fadeAnimation:false,attributionControl:false,scrollWheelZoom:false});
  L.control.scale({position:'bottomleft',maxWidth:94,metric:false}).addTo(map);
  function fit(box,maxZoom=18){map.fitBounds(bounds(box),{padding:[24,24],maxZoom,animate:false});}
  fit(C.bounds,11);
  const canvas=document.createElement('canvas');canvas.className='inspection-overlay';canvas.setAttribute('aria-hidden','true');map.getContainer().append(canvas);
  const ctx=canvas.getContext('2d'), pathCache=new WeakMap(), tiles=new Map(), pending=new Map(), failures=new Set();
  const positions=new Map();
  for(const row of records) if(row[1]!==null)positions.set(row,L.CRS.EPSG3857.latLngToPoint(L.latLng(row[1],row[2]),20).subtract(origin));
  const detailZoom=14; // Property outlines and street-level record symbols start at the same scale.
  const heatRadiusMeters=804.672; // Half a statute mile on Leaflet's spherical earth.
  const radians=Math.PI/180, heatAngle=heatRadiusMeters/L.CRS.Earth.R;
  const maxHaversine=Math.sin(heatAngle/2)**2;
  const heatCanvas=document.createElement('canvas'), heatContext=heatCanvas.getContext('2d');
  const mapStyle=getComputedStyle(document.documentElement);
  const heatColors=['--density-light','--density-mid','--density-dark'].map(name=>
    mapStyle.getPropertyValue(name).trim().split(/\s+/).map(Number));
  const singlePointColor=getComputedStyle(document.querySelector('.plain-point')).backgroundColor;
  const groupedPointColor=getComputedStyle(document.querySelector('.count-point')).backgroundColor;
  const selectedRecords=new Set();
  let chosen=null, selectedParcel=null,category='',scheduled=false;
  let width,height,scale,left,top,dpr,visible=[],markers=[];
  const pointLayer=byId('show-points'), propertyLayer=byId('show-parcels'), areaLayer=byId('show-areas'),sourceTax=byId('show-tax');
  const fromCity='https://mapit.fortworthtexas.gov/ags/rest/services/';
  const query=(layer,where,fields)=>fromCity+layer+'/query?'+new URLSearchParams({where,outFields:fields,returnGeometry:'false',f:'pjson'}).toString();
  const source=(url,text)=>'<a target="_blank" rel="noopener" href="'+esc(url)+'">'+esc(text)+'</a>';
  function addOption(select,id,label){select.append(new Option(label,id));}
  for(const area of C.areas)addOption(byId('area'),area[0],area[1]);
  for(const name of [...new Set(records.map(r=>r[4]))].sort())addOption(byId('category'),name,name);
  const t=C.totals;
  byId('coverage').textContent=C.sharedHomeLots
    ? 'The citywide view shows all '+fmt(t.records-t.missing)+' records with usable coordinates. A dot marks the location the city recorded. Its position alone cannot establish which parcel, unit or owner was cited.'
    : fmt(t.records)+' violation records. '+fmt(t.mapped)+' fell inside a neighborhood, '+fmt(t.outside)+' were outside all boundaries, and '+fmt(t.missing)+' lacked usable coordinates. The citywide view includes all '+fmt(t.records-t.missing)+' mappable records.';
  const coverage=fmt(t.taxRows)+' City tax parcel rows were returned by the inventory of all '+t.neighborhoods+' boundaries. ';
  const pendingDescription=C.complexes?' neighborhoods have complex boundaries or parcel links under review. ':' neighborhoods have land-lot questions that keep their rates under review. ';
  const interior=C.complexes?'':' Four documented interior land lots can be located only by their enclosing sites.';
  byId('property-coverage').textContent=C.sharedHomeLots ? coverage.trim() :
    coverage+t.held+pendingDescription+t.zero+' has a verified count of zero and no calculable rate.'+interior+' Changing violation type leaves each property count fixed.';
  function renderSummary(){
    const area=areas.get(chosen);
    const filtered=records.filter(row=>(!area||row[6].includes(chosen))&&(!category||row[4]===category));
    const count=filtered.length, properties=area?.[2], hasRate=properties>0;
    byId('area-heading').textContent=area?area[1]:'Fort Worth citywide';
    byId('numerator').textContent=fmt(count);
    byId('record-unit').textContent=count===1?'violation record':'violation records';
    byId('property-term').hidden=!area;
    byId('scale-term').hidden=!hasRate;
    byId('rate-term').hidden=!hasRate;
    byId('divide').textContent=hasRate?'÷':'·';
    byId('denominator').textContent=properties==null?'Property count pending':fmt(properties);
    byId('property-unit').textContent=properties==null?'':properties===1?' counted property':' counted properties';

    let note;
    if(hasRate){
      const result=(count*1000/properties).toLocaleString('en-US',{maximumFractionDigits:2});
      byId('rate').textContent=result;
      byId('rate-unit').textContent=result==='1'?'record per 1,000 properties':'records per 1,000 properties';
      note='One property can have several violation records. The property count includes properties with no records.';
    }else{
      byId('rate').textContent='—';
      if(!area){
        const mapped=filtered.filter(row=>row[1]!==null).length;
        note=fmt(mapped)+(mapped===1?' record has':' records have')+' a map location. Select a neighborhood to see its rate.';
      }else if(properties===0){
        note='A rate is unavailable because there are no qualifying properties in this neighborhood.';
      }else{
        const questions=C.complexReview?.[chosen];
        note=questions?(C.sharedHomeLots?'The property count is under review for ':'Complex membership or extent is under review for ')+questions.join(', ')+'.':'Some land lots are still under review. A rate is available once the property count is verified.';
      }
    }
    byId('rate-note').textContent=note;
  }
  function drawPending(){
    if(!scheduled)return;
    scheduled=false;
    draw();
  }
  function redraw(){if(!scheduled){scheduled=true;requestAnimationFrame(drawPending);}}
  window.parcelMapChunk=async(key,b64)=>{
    const entry=pending.get(key);if(!entry)return;
    try{
      const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
      const rows=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
      tiles.set(key,rows);entry.resolve(rows);
    }catch(e){failures.add(key);entry.reject(e);}
    finally{pending.delete(key);entry.script.remove();redraw();}
  };
  function load(key){
    if(tiles.has(key))return Promise.resolve(tiles.get(key));
    if(pending.has(key))return pending.get(key).promise;
    if(failures.has(key))return Promise.reject(Error('Map data file unavailable'));
    const script=document.createElement('script');let resolve,reject;
    const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
    pending.set(key,{promise,resolve,reject,script});script.src='data/'+key+'.js';
    script.onerror=()=>{pending.delete(key);failures.add(key);script.remove();reject(Error('Map data file unavailable'));redraw();};
    document.head.append(script);return promise;
  }
  function rowsIn(index,view){
    const out=[];
    for(const [key,box] of index){
      if(!intersects(view,box))continue;
      if(!tiles.has(key)){if(!failures.has(key))load(key).catch(()=>{});continue;}
      for(const row of tiles.get(key))if(intersects(view,row[1]))out.push(row);
    }
    return out;
  }
  function path(row,index=2,closed=true){
    if(pathCache.has(row))return pathCache.get(row);
    const p=new Path2D();
    for(const line of row[index]){p.moveTo(line[0],line[1]);for(let i=2;i<line.length;i+=2)p.lineTo(line[i],line[i+1]);if(closed)p.closePath();}
    pathCache.set(row,p);return p;
  }
  function screen(){ctx.setTransform(dpr,0,0,dpr,0,0);}
  function world(){ctx.setTransform(dpr*scale,0,0,dpr*scale,-left*dpr*scale,-top*dpr*scale);ctx.lineJoin='round';}
  function stroke(p,color,sw,dash=[]){ctx.strokeStyle=color;ctx.lineWidth=sw/scale;ctx.setLineDash(dash.map(x=>x/scale));ctx.stroke(p);ctx.setLineDash([]);}
  function fill(p,color){ctx.fillStyle=color;ctx.fill(p,'evenodd');}
  function densityView(){return chosen===null&&map.getZoom()<detailZoom;}
  function drawDensity(){
    if(width<1||height<1)return 0;
    // Sample each CSS pixel at its geographic center. A projected box limits the
    // search, but the cutoff and weights use spherical ground distance.
    const grid=new Float32Array(width*height);
    const longitudes=Float64Array.from({length:width},(_,x)=>geo(left+(x+.5)/scale,top).lng*radians);
    const latitudes=Float64Array.from({length:height},(_,y)=>geo(left,top+(y+.5)/scale).lat*radians);
    const cosLatitudes=latitudes.map(Math.cos), longitudeTerms=new Float64Array(width);
    const equatorRadius=L.CRS.EPSG3857.scale(20)*scale*heatAngle/(2*Math.PI);
    let count=0;
    for(const [record,pos] of positions){
      if(category&&record[4]!==category)continue;
      count++;
      const lat=record[1]*radians, lon=record[2]*radians, cosLat=Math.cos(lat);
      const reach=equatorRadius/Math.cos(Math.abs(lat)+heatAngle);
      const x=(pos.x-left)*scale-.5, y=(pos.y-top)*scale-.5;
      const firstX=Math.max(0,Math.ceil(x-reach)), lastX=Math.min(width-1,Math.floor(x+reach));
      const firstY=Math.max(0,Math.ceil(y-reach)), lastY=Math.min(height-1,Math.floor(y+reach));
      if(firstX>lastX||firstY>lastY)continue;
      for(let i=firstX;i<=lastX;i++)longitudeTerms[i]=cosLat*Math.sin((longitudes[i]-lon)/2)**2;
      for(let j=firstY;j<=lastY;j++){
        const latitudeTerm=Math.sin((latitudes[j]-lat)/2)**2;
        for(let i=firstX;i<=lastX;i++){
          const haversine=latitudeTerm+cosLatitudes[j]*longitudeTerms[i];
          if(haversine>=maxHaversine)continue;
          const distanceFraction=2*Math.asin(Math.sqrt(haversine))/heatAngle;
          grid[j*width+i]+=1-distanceFraction**2;
        }
      }
    }
    if(heatCanvas.width!==width||heatCanvas.height!==height){heatCanvas.width=width;heatCanvas.height=height;}
    const pixels=heatContext.createImageData(width,height);
    for(let i=0;i<grid.length;i++){
      const value=grid[i];
      if(value===0)continue;
      // Keep an absolute scale through pans, zooms and category filters. A weighted
      // sum of 50 reaches the darkest shade in this two-week display.
      const fraction=Math.min(1,Math.log1p(value)/Math.log(51));
      const segment=fraction<.5?0:1, blend=2*fraction-segment;
      for(let channel=0;channel<3;channel++){
        pixels.data[4*i+channel]=heatColors[segment][channel]*(1-blend)+heatColors[segment+1][channel]*blend;
      }
      pixels.data[4*i+3]=Math.min(1,value)*(130+75*fraction);
    }
    heatContext.putImageData(pixels,0,0);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(heatCanvas,0,0);
    return count;
  }
  const credits=byId('attribution'), baseStatus=byId('basemap-status');
  const streetCredit='CARTO Positron · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · © <a href="https://carto.com/attributions">CARTO</a>';
  credits.innerHTML=streetCredit;
  const localPreview=location.protocol==='file:'||['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  if(localPreview){
    credits.innerHTML+=' · <a href="https://protomaps.com/">Protomaps</a>';
    baseStatus.textContent='Loading local Positron streets…';
    const loader=document.createElement('script');
    loader.src='../local-positron/start.js';
    loader.onload=()=>window.startFortWorthPositron(map,baseStatus).catch(()=>{
      baseStatus.textContent='Local Positron streets could not load. Open the complete preview folder in a browser with WebGL 2.';
    });
    loader.onerror=()=>{baseStatus.textContent='The local Positron basemap folder is missing.';};
    document.head.append(loader);
  }else{
    const streets=L.tileLayer(window.roundupStreets,{minZoom:8,maxZoom:20,maxNativeZoom:16,noWrap:true,keepBuffer:1});
    let loaded=0,failed=0;
    streets.on('loading',()=>{loaded=failed=0;});
    streets.on('tileload',()=>{loaded++;});
    streets.on('tileerror',()=>{failed++;});
    streets.on('load',()=>{baseStatus.textContent=failed?(loaded?'Some CARTO street tiles could not load.':'CARTO streets are unavailable from this page.') : '';});
    streets.addTo(map);
  }
  function draw(){
    const size=map.getSize(),z=map.getZoom();
    width=size.x;height=size.y;dpr=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=width+'px';canvas.style.height=height+'px';
    }
    screen();ctx.clearRect(0,0,width,height);
    const corner=map.project(map.containerPointToLatLng([0,0]),20).subtract(origin);
    left=corner.x;top=corner.y;scale=2**(z-20);
    const overview=densityView();
    byId('density-key').hidden=!pointLayer.checked||!overview;
    byId('point-key').hidden=!pointLayer.checked||overview;
    document.querySelector('.icon.point').classList.toggle('density',overview);
    const densityCount=pointLayer.checked&&overview?drawDensity():0;
    canvas.dataset.recordStyle=pointLayer.checked?(overview?'density':'points'):'hidden';
    canvas.dataset.densityRecords=String(densityCount);
    const view=[left,top,left+width/scale,top+height/scale];world();
    const inView=C.areas.filter(a=>intersects(view,a[3]));
    if(areaLayer.checked){
      for(const a of inView){const p=path(a,4);fill(p,a[0]===chosen?'#16837523':'#3f85630a');if(a[0]!==chosen)stroke(p,'#428178b0',z<13?.85:1.3);}
    }
    const tax=sourceTax.checked;
    visible=z>=detailZoom&&propertyLayer.checked?rowsIn(C.parcelTiles,view).filter(row=>tax?row[3].length:
      row[4].some(unit=>chosen?unit[1].includes(chosen):unit[1].length)): [];
    const regular=new Path2D(),enclosing=new Path2D();
    for(const r of visible){
      if(!tax&&r[4].every(u=>u[2]))enclosing.addPath(path(r));else regular.addPath(path(r));
    }
    if(!tax)fill(regular,'#599e7420');
    stroke(regular,tax?'#495956c5':'#306748',z<=15?.75:1.15);stroke(enclosing,'#875015',1.9,[5,3]);
    if(areaLayer.checked&&chosen){const a=areas.get(chosen);stroke(path(a,4),'#fff',4);stroke(path(a,4),'#006e64',2.8);}
    if(propertyLayer.checked&&selectedParcel){stroke(path(selectedParcel),'#fff9da',5.3);stroke(path(selectedParcel),'#ad5204',3.5);}
    screen();markers=[];
    if(pointLayer.checked&&!overview){
      const bins=new Map();
      for(const [r,p] of positions){
        if((chosen&&!r[6].includes(chosen))||(category&&r[4]!==category))continue;
        const x=(p.x-left)*scale,y=(p.y-top)*scale;if(x< -12||y< -12||x>width+12||y>height+12)continue;
        const key=z>=17?r[1]+','+r[2]:Math.floor(x/14)+','+Math.floor(y/14);
        let b=bins.get(key);if(!b){b={x:0,y:0,rows:[]};bins.set(key,b);}
        b.x+=x;b.y+=y;b.rows.push(r);
      }
      for(const b of bins.values()){
        const n=b.rows.length;b.x/=n;b.y/=n;b.radius=n>1?Math.min(15,7+Math.log2(n)):4.5;
        const active=b.rows.some(r=>selectedRecords.has(r[0]));
        ctx.beginPath();ctx.arc(b.x,b.y,b.radius,0,2*Math.PI);
        if(active){ctx.lineWidth=6;ctx.strokeStyle=groupedPointColor;ctx.stroke();}
        ctx.fillStyle=n>1?groupedPointColor:singlePointColor;ctx.fill();
        ctx.lineWidth=active?2.8:1.4;ctx.strokeStyle='#fff';ctx.stroke();
        if(n>1){ctx.fillStyle='#fff';ctx.font='bold 10px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(n,b.x,b.y);}
        markers.push(b);
      }
    }
    let mapTip=pointLayer.checked?'Click a dot or a neighborhood to inspect it.':'Choose a neighborhood to inspect its count.';
    if(overview&&pointLayer.checked)mapTip='Select a neighborhood or zoom in for individual records.';
    else if(propertyLayer.checked){
      if(z<detailZoom)mapTip='Zoom in for property lines.';
      else if(tax)mapTip='Gray outlines show city tax parcels. Click an outline for its city record.';
      else mapTip=C.complexes?'Green outlines show the properties used for the rate.':'Green outlines show counted properties. A dashed outline locates lots whose individual boundaries are unavailable.';
    }
    if(pending.size)mapTip='Loading map detail…';
    if(failures.size)mapTip='A detail file could not be opened. Reopen the complete map folder.';
    byId('map-status').textContent=mapTip;
    canvas.dataset.visibleParcels=String(visible.length);canvas.dataset.markers=String(markers.length);
  }
  const panel=byId('selection');
  function neighborhoodSelect(id,zoom=true){
    chosen=id;selectedParcel=null;selectedRecords.clear();byId('area').value=id??'';
    renderSummary();
    if(id){
      areaLayer.checked=true;
      const a=areas.get(id);if(zoom)fit(a[3],17);
      panel.innerHTML='<h2>Inspect '+esc(a[1])+'</h2><p>Click a dot for its violation records or a property outline to see how the land was counted.</p>';
    }else{
      if(zoom)fit(C.bounds,11);
      panel.innerHTML='<h2>Inspect a location</h2><p>Select a neighborhood or zoom in to inspect individual records and property outlines.</p>';
    }
    redraw();
  }
  function listButtons(parent,items,label,click){
    const wrap=document.createElement('div');wrap.className='choices';
    for(const item of items){
      const button=document.createElement('button');button.type='button';button.textContent=label(item);button.addEventListener('click',()=>click(item));wrap.append(button);
    }
    parent.append(wrap);
  }
  function areaButtons(ids){
    if(ids.length)listButtons(panel,ids,i=>'Inspect '+areas.get(i)[1],i=>neighborhoodSelect(i));
  }
  function violationEntry([id,lat,lon,date,type,status,areaIds]){
    const link=query('CIVIC/Code_Violations_Experience_Builder/MapServer/4','Violation_ID='+id,'Violation_ID,Violation_Created_Date,Complaint_Type_Description,Violation_Current_Status,Latitude,Longitude');
    const located=lat!==null&&lon!==null;
    const membership=areaIds.length?names(areaIds):located?'Outside all mapped neighborhoods':'Unknown without coordinates';
    const coordinates=located?lat.toFixed(6)+', '+lon.toFixed(6):'No usable coordinates';
    return '<li class="violation-record" data-violation-id="'+esc(id)+'">'+
      '<h3>'+source(link,'City record '+id)+'</h3><dl>'+
      '<dt>Type</dt><dd>'+esc(type||'Unlisted')+'</dd>'+
      '<dt>Created</dt><dd>'+(date?'<time datetime="'+esc(date)+'">'+esc(date)+'</time>':'Unlisted')+'</dd>'+
      '<dt>Status at capture</dt><dd>'+esc(status||'Unlisted')+'</dd>'+
      '<dt>Neighborhood'+(areaIds.length>1?'s':'')+'</dt><dd>'+esc(membership)+'</dd>'+
      '<dt>Coordinates</dt><dd>'+esc(coordinates)+'</dd></dl>'+
      (areaIds.length?'':'<p>Included in the citywide total.</p>')+'</li>';
  }
  function recordList(rows,location){
    selectedRecords.clear();
    for(const row of rows)selectedRecords.add(row[0]);
    selectedParcel=null;
    const count=fmt(rows.length)+(rows.length===1?' violation record':' violation records');
    panel.innerHTML='<h2>'+esc(count+' '+location)+'</h2><ul class="violation-list" role="list">'+
      rows.map(violationEntry).join('')+'</ul>';
    areaButtons([...new Set(rows.flatMap(row=>row[6]))]);
    panel.parentElement.scrollTop=0;
    redraw();
  }
  function parcelTitle(row){const d=row[3][0];return sourceTax.checked&&d?'Parcel '+(d[1]||'• City row '+d[2][0]):row[4].length?(C.complexes?.[row[4][0][0]]?.[0]||'Property '+row[4][0][0].split('/').at(-1)):'City parcel';}
  function parcelDetail(row){
    selectedParcel=row;selectedRecords.clear();const tax=row[3],units=row[4];
    let info='<p class="kicker">'+(sourceTax.checked?'City tax footprint':'Property footprint')+'</p><h2>'+esc(parcelTitle(row))+'</h2>';
    for(const [county,pin,oids,site,group] of tax){
      const link=query('Planning_Development/Zoning/MapServer/35','OBJECTID='+oids[0],'OBJECTID,COUNTY,TAXPIN,STATE_USE_CODE,PARCEL_LEGAL_DESCRIPTION');
      info+='<p>'+esc(pin?'County '+county+' · parcel ID '+pin:'City parcel ID unavailable')+'<br>'+fmt(oids.length)+' City '+(oids.length===1?'row uses':'rows use')+' this outline. '+source(link,'See a City source row')+'</p>';
      if(group)info+='<p>Reviewed property: '+esc(group.split('/').slice(1).join(' / '))+'.</p>';
      const outstanding=C.propertyReviews?.[site||('parcel/'+county+'/'+pin)];
      if(outstanding)info+='<p>Parcel membership is being checked for '+esc(outstanding.join(', '))+'. See the neighborhood summary for rate availability.</p>';
      if(C.complexes?.[site])info+='<p>Part of '+esc(C.complexes[site][0])+'. The complex counts once in each qualifying neighborhood.</p>';
      if(site&&C.sites[site]){
        const [lots,contained,reason]=C.sites[site];
        if(site.startsWith('condominium/'))info+='<p>'+esc(site.slice('condominium/'.length))+'</p>';
        if(lots===null){info+='<p>Underlying land lots are under review. '+esc(reason.charAt(0).toUpperCase()+reason.slice(1))+'.</p>';}
        else{
          if(lots.length)info+='<p>Documented mapped land lots: '+lots.map(id=>source(query('CIVIC/OpenData_Boundaries/MapServer/51','OBJECTID='+id,'OBJECTID,CFWLAND_ID,BLOCK_ID,LOT_NO,TRACT_NO,GIS_LINK'),id)).join(', ')+'. Use the properties layer to see their boundaries.</p>';
          if(contained.length)info+='<p>Documented interior land lots: '+contained.map(esc).join(', ')+'. Only the enclosing site outline is available.</p>';
          if(!lots.length&&!contained.length)info+='<p>'+esc(reason.charAt(0).toUpperCase()+reason.slice(1))+'. This outline adds no separate property.</p>';
        }
      }
    }
    for(const [key,ids,proxy] of units){
      let label=key.startsWith('city-land/')?'City ground lot '+key.split('/')[1]:key.split('/').slice(1).join(' / ');
      if(C.complexes?.[key]){const [name,n,reason,pin]=C.complexes[key];label=name;
        const link=query('Planning_Development/Zoning/MapServer/35',"COUNTY='220' AND TAXPIN='"+pin.replaceAll("'","''")+"'","COUNTY,TAXPIN,PARCEL_LEGAL_DESCRIPTION,STATE_USE_CODE");
        info+='<p>'+esc(reason)+' '+fmt(n)+(n===1?' parcel ID.':' parcel IDs in this complex.')+' '+source(link,'Inspect a constituent City parcel')+'</p>';}
      if(key.startsWith('city-land/'))label=source(query('CIVIC/OpenData_Boundaries/MapServer/51','OBJECTID='+key.split('/')[1],'OBJECTID,CFWLAND_ID,BLOCK_ID,LOT_NO,TRACT_NO,GIS_LINK'),label);else label=esc(label);
      info+='<p><strong>'+label+'</strong><br>'+esc(ids.length?'Assigned once in '+names(ids)+'.':(C.propertyReviews?.[key]?'Assignment under review.':'No neighborhood meets the assignment rule.'))+(proxy?' The outline locates the enclosing site. Its internal lot line is unavailable.':'')+'</p>';
    }
    if(units.length===1&&!units[0][2]&&row[5]!=null&&units[0][0].startsWith('parcel/')){
      const pct=row[5]===1?'100':row[5]>.99999?'>99.999':(100*row[5]).toLocaleString('en-US',{maximumFractionDigits:3});
      info+='<p>Largest neighborhood share of this footprint: '+esc(pct)+'%.</p>';
    }
    const shared=tax.filter(t=>t[0]==='220').map(t=>C.sharedHomeLots?.[t[1]]).find(Boolean);
    if(shared)info+='<p>This lot is shared land. Its '+fmt(shared[1])+' separately assessed homes account for the entire recorded interest, so it adds no property to the count.</p>';
    else if(!units.length&&!tax.some(t=>t[3]||t[4]))info+='<p>This source outline adds no property to the neighborhood count.</p>';
    panel.innerHTML=info;
    const ids=[...new Set(units.flatMap(u=>u[1]))];areaButtons(ids);redraw();
  }
  function hit(latlng){
    drawPending();
    const pt=map.project(latlng,20).subtract(origin),xy=map.latLngToContainerPoint(latlng);
    const near=pointLayer.checked&&!densityView()?markers.filter(b=>Math.hypot(b.x-xy.x,b.y-xy.y)<=b.radius+4).sort((a,b)=>Math.hypot(a.x-xy.x,a.y-xy.y)-Math.hypot(b.x-xy.x,b.y-xy.y)):[];
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    const contains=(r,i)=>ctx.isPointInPath(path(r,i),pt.x,pt.y,'evenodd');
    const parcels=visible.filter(r=>intersects(r[1],[pt.x,pt.y,pt.x,pt.y])&&contains(r,2));
    const neighborhoods=areaLayer.checked?C.areas.filter(a=>intersects(a[3],[pt.x,pt.y,pt.x,pt.y])&&contains(a,4)):[];
    ctx.restore();
    if(near.length){
      recordList(near[0].rows,'in this dot');
      if(parcels.length)listButtons(panel,parcels,parcelTitle,parcelDetail);
    }else if(parcels.length){parcelDetail(parcels[0]);if(parcels.length>1)listButtons(panel,parcels,parcelTitle,parcelDetail);}
    else if(neighborhoods.length===1)neighborhoodSelect(neighborhoods[0][0],densityView());
    else if(neighborhoods.length){panel.innerHTML='<h2>Overlapping neighborhoods</h2>';areaButtons(neighborhoods.map(a=>a[0]));}
    else if(pointLayer.checked&&densityView()&&records.some(r=>r[1]!==null&&(!category||r[4]===category)&&map.distance(latlng,[r[1],r[2]])<heatRadiusMeters)){
      map.setView(latlng,detailZoom,{animate:false});
      panel.innerHTML='<h2>Inspect a location</h2><p>Select a dot to see its city records.</p>';
    }else{panel.innerHTML='<h2>No feature selected</h2><p>Choose a neighborhood or zoom in to inspect a record or property.</p>';selectedParcel=null;selectedRecords.clear();redraw();}
  }
  byId('area').onchange=e=>neighborhoodSelect(e.target.value?Number(e.target.value):null);
  byId('category').onchange=e=>{category=e.target.value;neighborhoodSelect(chosen,false);};
  byId('city').onclick=()=>{category='';byId('category').value='';neighborhoodSelect(null);};
  byId('missing').onclick=()=>{recordList(records.filter(r=>r[1]===null),'without usable coordinates');panel.parentElement.scrollIntoView({block:'nearest'});};
  propertyLayer.onchange=redraw;areaLayer.onchange=redraw;
  pointLayer.onchange=redraw;
  function showParcelSource(){
    byId('parcel-label').textContent=sourceTax.checked?'City tax parcels':'Counted properties';
    document.querySelector('.icon.parcel').classList.toggle('tax',sourceTax.checked);
  }
  sourceTax.onchange=()=>{
    propertyLayer.checked=true;
    showParcelSource();
    neighborhoodSelect(chosen,false);
  };
  showParcelSource();
  map.on('click',e=>hit(e.latlng));map.on('move zoom resize',redraw);
  map.getContainer().addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target===map.getContainer()){e.preventDefault();hit(map.getCenter());}});
  const touchButton=byId('touch-toggle');
  if(matchMedia('(pointer: coarse)').matches){
    function touchMode(on){
      touchButton.hidden=false;touchButton.setAttribute('aria-pressed',String(on));touchButton.textContent=on?'Done':'Explore map';
      map.getContainer().classList.toggle('touch-rest',!on);
      for(const handler of [map.dragging,map.touchZoom,map.doubleClickZoom])on?handler.enable():handler.disable();
    }
    touchMode(false);touchButton.onclick=()=>touchMode(touchButton.getAttribute('aria-pressed')!=='true');
  }
  const resize=new ResizeObserver(()=>{map.invalidateSize({pan:false});redraw();});resize.observe(map.getContainer());
  if(window.parent!==window)new ResizeObserver(()=>window.parent.postMessage({type:'fw-inspector-height',height:document.querySelector('main').getBoundingClientRect().height},'*')).observe(document.querySelector('main'));
  const initialArea=Number(new URLSearchParams(location.search).get('neighborhood'));
  if(areas.has(initialArea))neighborhoodSelect(initialArea);
  else{renderSummary();redraw();}
})();
