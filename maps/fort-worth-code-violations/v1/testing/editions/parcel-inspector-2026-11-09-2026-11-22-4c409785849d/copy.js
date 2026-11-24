'use strict';
const copyButton=document.getElementById('copy'), statusLine=document.getElementById('copy-status'), manual=document.getElementById('manual');
if(location.protocol==='https:') statusLine.textContent='';
copyButton.addEventListener('click',async()=>{
  try{
    await navigator.clipboard.writeText(window.inspectorEmbed);
    manual.hidden=true;statusLine.textContent='Copied the CUE embed HTML.';
  }catch{
    manual.value=window.inspectorEmbed;manual.hidden=false;manual.focus();manual.select();
    statusLine.textContent='Copy the selected embed HTML with your keyboard.';
  }
});
window.addEventListener('message',event=>{
  const frame=document.querySelector('iframe');
  if(event.source===frame.contentWindow && event.data?.type==='fw-inspector-height' && Number.isFinite(event.data.height)){
    frame.style.height=Math.min(20000,Math.max(540,Math.ceil(event.data.height)))+'px';
  }
});
