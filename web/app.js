"use strict";
const ROWS="ABCDEFGH", COLS=12, LAYOUT_VERSION=2;
const state={imported:null,layout:{version:LAYOUT_VERSION,annotations:{},curves:{},settings:{}},selected:new Set(),history:[],preview:null,result:null};
const $=id=>document.getElementById(id);
function coordinate(w){return [ROWS.indexOf(w[0]),Number(w.slice(1))-1]}
function rect(a,b){const [r1,c1]=coordinate(a),[r2,c2]=coordinate(b),v=[];for(let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++)for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++)v.push(ROWS[r]+(c+1));return v}
function sortedWells(set){return [...set].sort((a,b)=>{const [ar,ac]=coordinate(a),[br,bc]=coordinate(b);return ar-br||ac-bc})}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c])}
function renderPlate(){
  const grid=$("plate");grid.innerHTML="";
  for(let i=0;i<13;i++){const d=document.createElement("div");d.className="plate-head";d.textContent=i||"";grid.append(d)}
  for(const row of ROWS){const label=document.createElement("div");label.className="plate-head";label.textContent=row;grid.append(label);
    for(let c=1;c<=12;c++){const well=row+c,reading=state.imported?.wells.find(w=>w.well===well),annotation=state.layout.annotations[well],d=document.createElement("div");d.className="well "+(reading?.measurement_status||"empty")+(annotation&&annotation.role!=="ignore"?" "+annotation.role:"")+(state.selected.has(well)?" selected":"");d.dataset.well=well;d.setAttribute("role","gridcell");d.setAttribute("aria-label",`${well} ${reading?.measurement_status||"empty"} ${reading?.raw_value??""}`);d.innerHTML=`<b>${well}</b><small>${escapeHtml(reading?.raw_value??"—")}</small>`;d.title=`${well}: ${reading?.measurement_status||"empty"}${annotation?` • ${annotation.role} ${annotation.curve_id||annotation.sample_id||""}`:""}`;grid.append(d)}}
  updateSelection();
}
function updateSelection(){document.querySelectorAll(".well").forEach(d=>d.classList.toggle("selected",state.selected.has(d.dataset.well)));$("selection-count").textContent=`${state.selected.size} well${state.selected.size===1?"":"s"} selected`;$("selection-list").textContent=sortedWells(state.selected).join(", ")}
let drag=null;
function wellAt(e){return document.elementFromPoint(e.clientX,e.clientY)?.closest(".well")?.dataset.well}
$("plate").addEventListener("pointerdown",e=>{const w=wellAt(e);if(!w)return;e.preventDefault();drag={start:w,base:e.ctrlKey||e.metaKey?new Set(state.selected):new Set(),pointer:e.pointerId};$("plate").setPointerCapture(e.pointerId);state.selected=new Set([...drag.base,...rect(w,w)]);updateSelection()});
$("plate").addEventListener("pointermove",e=>{if(!drag||e.pointerId!==drag.pointer)return;const w=wellAt(e);if(!w)return;state.selected=new Set([...drag.base,...rect(drag.start,w)]);updateSelection()});
function endDrag(e){if(drag&&e.pointerId===drag.pointer){drag=null;renderEditor()}}
$("plate").addEventListener("pointerup",endDrag);$("plate").addEventListener("pointercancel",endDrag);
$("clear-selection").onclick=()=>{state.selected.clear();updateSelection();renderEditor()};
$("undo").onclick=()=>{if(!state.history.length)return;state.layout=state.history.pop();state.result=null;state.preview=null;renderPlate();renderEditor();renderAnalysis()};
async function api(path,payload,blob=false){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});if(!r.ok){let msg;try{msg=(await r.json()).error}catch{msg=r.statusText}throw new Error(msg||`HTTP ${r.status}`)}return blob?await r.blob():await r.json()}
function showMessage(id,text,kind="error"){$(id).innerHTML=text?`<div class="${kind}">${escapeHtml(text)}</div>`:""}
function saveHistory(){state.history.push(structuredClone(state.layout));if(state.history.length>30)state.history.shift()}
function currentReading(well){return state.imported?.wells.find(w=>w.well===well)}
function assignedStandardCurveIds(){const assigned=new Set(Object.values(state.layout.annotations).filter(a=>a.role==="standard"&&a.include).map(a=>a.curve_id));return Object.keys(state.layout.curves).filter(id=>assigned.has(id))}
function optionField(label,id,options,value){return `<label class="field"><span class="field-caption">${escapeHtml(label)}</span><select id="${id}">${options.map(([v,t])=>`<option value="${escapeHtml(v)}" ${v===value?"selected":""}>${escapeHtml(t)}</option>`).join("")}</select></label>`}
function inputField(label,id,value="",type="text",extra=""){return `<label class="field"><span class="field-caption">${escapeHtml(label)}</span><input id="${id}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`}
function qcField(label,id,control,help){const helpId=`help-${id}`,helpControl=help?`<span class="qc-help"><button type="button" class="qc-help-button" aria-label="Help for ${escapeHtml(label)}" aria-describedby="${helpId}">?</button><span class="qc-help-popup" id="${helpId}" role="tooltip">${escapeHtml(help)}</span></span>`:"";return `<div class="field qc-field"><div class="qc-label-row"><label for="${id}">${escapeHtml(label)}</label>${helpControl}</div>${control}</div>`}
function qcOptionField(label,id,options,value,help){return qcField(label,id,`<select id="${id}">${options.map(([v,t])=>`<option value="${escapeHtml(v)}" ${v===value?"selected":""}>${escapeHtml(t)}</option>`).join("")}</select>`,help)}
function qcNumberField(label,id,value,help){return qcField(label,id,`<input id="${id}" type="number" value="${escapeHtml(value)}" min="0" step="any">`,help)}
function positionQcHelp(button){
  const popup=button.nextElementSibling,anchor=button.getBoundingClientRect(),box=popup.getBoundingClientRect();
  const left=Math.max(12,Math.min(anchor.left+anchor.width/2-box.width/2,window.innerWidth-box.width-12));
  popup.style.left=`${left-anchor.left}px`;popup.style.transform="none";
  if(window.innerHeight-anchor.bottom<box.height+12&&anchor.top>box.height+12){popup.style.top="auto";popup.style.bottom="calc(100% + 7px)"}
  else{popup.style.top="calc(100% + 7px)";popup.style.bottom="auto"}
}
function renderEditor(){
  const root=$("editor-root");if(!state.imported){root.innerHTML="<p class='hint'>Import a workbook to begin annotation.</p>";return}
  const selected=sortedWells(state.selected),one=selected.length===1?state.layout.annotations[selected[0]]:null;
  root.innerHTML=`<div class="legend"><span class="overflow-key">Overflow</span></div>
    ${assignedStandardCurveIds().length?"":"<div id='standards-first-note' class='setup-note' role='status'><strong>Start with standards.</strong> Select the standard wells, choose Standard, enter their concentrations, and assign them. Then you can assign unknown samples to that standard curve.</div>"}
    <h3 class="assignment-heading">Assign selected wells</h3><div class="assignment-toolbar">${optionField("Role","role",[["standard","Standard"],["unknown","Unknown"],["blank","Blank"],["ignore","Ignored"]],one?.role||"standard")}
    <div class="assignment-actions"><button id="assign-button" class="primary" ${selected.length?"":"disabled"}>Assign selected wells</button><button id="preview-button" ${selected.length?"":"disabled"}>Preview assignment</button><button id="edit-wells" ${selected.length?"":"disabled"}>Edit selected wells in table</button>${selected.length===1?`<button id="clear-well-assignment" ${one?"":"disabled"}>Clear ${selected[0]} assignment</button>`:""}</div></div>
    <div id="role-fields"></div><div id="editor-message"></div><div id="assignment-preview"></div>
    <hr><h3>Standard curves and layout</h3><p class="hint">A standard curve is created when you assign standard wells. Edit its units below if needed. All curves use the same plate-wide blank mean.</p>
    <div id="curve-list"></div>
    <div class="row"><label class="file-label">Load saved layout JSON <input id="layout-file" type="file" accept=".json"></label><button id="download-layout" ${state.imported?"":"disabled"}>Download layout JSON</button><button id="clear-layout">Clear current layout</button></div><div id="layout-preview"></div>`;
  $("role").onchange=renderRoleFields;renderRoleFields();renderCurveList();
  $("assign-button").onclick=()=>{if(previewAssignment())commitAssignment()};
  $("preview-button").onclick=previewAssignment;
  $("edit-wells").onclick=()=>{state.preview={draft:selected.map(well=>({well,reading:currentReading(well),annotation:structuredClone(state.layout.annotations[well]||{role:"unassigned",include:false,exclusion_reason:"",curve_id:"",nominal_concentration:null,sample_id:"",replicate_group:"",dilution_factor:null})})),curve:null,editing:true};showMessage("editor-message","");renderAssignmentPreview()};
  if($("clear-well-assignment"))$("clear-well-assignment").onclick=()=>{const well=selected[0];if(!state.layout.annotations[well])return;saveHistory();delete state.layout.annotations[well];state.preview=null;state.result=null;renderPlate();renderEditor();renderAnalysis();showMessage("editor-message",`${well} assignment cleared; its OD reading remains on the plate.`,"success")};
  $("layout-file").onchange=loadLayoutFile;$("download-layout").onclick=downloadLayout;
  $("clear-layout").onclick=()=>{saveHistory();state.layout={version:LAYOUT_VERSION,annotations:{},curves:{},settings:{}};state.selected.clear();state.preview=null;state.pendingLayout=null;state.result=null;renderPlate();renderEditor();renderAnalysis()};
}
function renderRoleFields(){const role=$("role").value,selected=sortedWells(state.selected),one=selected.length===1?state.layout.annotations[selected[0]]:null;
  if($("standards-first-note"))$("standards-first-note").hidden=role==="unknown";
  let html="";
  if(role==="standard")html=`<div class="field-grid">${inputField("Standard curve ID","a-curve",one?.curve_id||"standard1")}${inputField("Units","a-units",state.layout.curves[one?.curve_id]?.units||"ng/mL")}${inputField("Concentrations, ordered comma-separated","a-series",one?.nominal_concentration??"0")}${inputField("Replicate wells per level","a-reps","1","number","min='1' step='1'")}${optionField("Replicate direction","a-direction",[["row","Across rows"],["column","Down columns"]],"row")}</div>`;
  else if(role==="unknown"){
    const ids=assignedStandardCurveIds(),chosen=ids.includes(one?.curve_id)?one.curve_id:ids[0]||"";
    const curveField=ids.length?optionField("Standard curve","a-curve",ids.map(id=>[id,id]),chosen):"";
    html=`${ids.length?"":"<div class='setup-note' role='status'><strong>Unknown assignment is waiting for standards.</strong> Assign the standard wells and their concentrations first. <button id='switch-to-standard' type='button'>Choose Standard</button></div>"}<div class="field-grid">${curveField}${inputField("Sample name or prefix","a-sample",one?.sample_id||"Sample")}${inputField("Replicate wells per sample","a-reps",Math.max(1,selected.length),"number","min='1' step='1'")}${inputField("Dilution factor","a-dilution",one?.dilution_factor??1,"number","min='0.000001' step='any'")}${optionField("Replicate direction","a-direction",[["row","Across rows"],["column","Down columns"]],"row")}</div>`;
  }
  else if(role==="blank")html=`<p class="hint">All included blank wells form one plate-wide mean.</p>`;
  else html=`<p class="hint">Ignored wells are kept in the audit trail and omitted from analysis.</p>`;
  $("role-fields").innerHTML=html;
  const canAssign=selected.length>0&&(role!=="unknown"||assignedStandardCurveIds().length>0);
  $("assign-button").disabled=!canAssign;$("preview-button").disabled=!canAssign;
  if($("switch-to-standard"))$("switch-to-standard").onclick=()=>{$("role").value="standard";renderRoleFields()};
  if(role==="standard"){$("a-curve").onchange=()=>{const existing=state.layout.curves[$("a-curve").value.trim()];if(existing){$("a-units").value=existing.units;$("a-units").disabled=true}else{$("a-units").disabled=false}};$("a-curve").onchange()}
}
function selectedInOrder(direction){const wells=sortedWells(state.selected);return direction==="column"?wells.sort((a,b)=>{const [ar,ac]=coordinate(a),[br,bc]=coordinate(b);return ac-bc||ar-br}):wells}
function previewAssignment(){try{
  const role=$("role").value,direction=$("a-direction")?.value||"row",wells=selectedInOrder(direction);if(!wells.length)throw Error("Select wells first.");
  const draft=[];let series=[],reps=1;
  if(role==="standard"){const parts=$("a-series").value.split(",").map(s=>s.trim());series=parts.map(Number);reps=Number($("a-reps").value);if(!parts.length||parts.some(s=>s==="")||series.some(x=>!Number.isFinite(x)||x<0))throw Error("Enter finite nonnegative concentrations separated by commas.");if(!Number.isInteger(reps)||reps<1)throw Error("Replicates per level must be a positive integer.");if(series.length===1)reps=wells.length;else if(series.length*reps<wells.length||series.length*reps>=wells.length+reps)throw Error(`${series.length} levels × ${reps} replicates does not match ${wells.length} selected wells. A partial final level is allowed.`)}
  if(role==="unknown"){if(!assignedStandardCurveIds().length)throw Error("Assign standard wells and their concentrations before unknown wells.");reps=Number($("a-reps").value);if(!Number.isInteger(reps)||reps<1)throw Error("Replicates per sample must be a positive integer.");if(!Number.isFinite(Number($("a-dilution").value))||Number($("a-dilution").value)<=0)throw Error("Dilution factor must be positive.");if(!$('a-sample').value.trim())throw Error("Enter a sample name or prefix.")}
  for(let i=0;i<wells.length;i++){const well=wells[i],annotation={role,include:role!=="ignore",exclusion_reason:"",curve_id:"",nominal_concentration:null,sample_id:"",replicate_group:"",dilution_factor:null};
    if(role==="standard"){annotation.curve_id=$("a-curve").value.trim();annotation.nominal_concentration=series[Math.floor(i/reps)];annotation.replicate_group=`${annotation.curve_id}_level_${Math.floor(i/reps)+1}`}
    if(role==="unknown"){annotation.curve_id=$("a-curve").value.trim();const group=Math.floor(i/reps)+1,totalGroups=Math.ceil(wells.length/reps),name=$("a-sample").value.trim();annotation.sample_id=totalGroups===1?name:`${name}${group}`;annotation.replicate_group=annotation.sample_id;annotation.dilution_factor=Number($("a-dilution").value)}
    draft.push({well,reading:currentReading(well),annotation});}
  if(role==="standard"||role==="unknown")if(!$("a-curve").value.trim())throw Error("Choose or enter a standard curve ID.");
  const curveId=role==="standard"?$("a-curve").value.trim():null;
  state.preview={draft,curve:curveId&&!state.layout.curves[curveId]?{id:curveId,units:$("a-units").value.trim()||"concentration units"}:null};showMessage("editor-message","");renderAssignmentPreview();return true;
 }catch(e){showMessage("editor-message",e.message);return false}}
function previewCurveControl(a){
  if(a.role!=="unknown")return `<input data-key="curve_id" value="${escapeHtml(a.curve_id)}">`;
  const ids=assignedStandardCurveIds();
  return `<select data-key="curve_id">${ids.map(id=>`<option value="${escapeHtml(id)}" ${id===a.curve_id?"selected":""}>${escapeHtml(id)}</option>`).join("")}</select>`;
}
function renderAssignmentPreview(){const p=state.preview;if(!p)return;const warnings=p.draft.filter(x=>x.annotation.role!=="unassigned"&&x.annotation.role!=="ignore"&&x.annotation.include&&x.reading?.measurement_status!=="numeric").map(x=>`${x.well} is ${x.reading?.measurement_status||"empty"}`);
  $("assignment-preview").innerHTML=`<div class="preview"><h3>${p.editing?"Edit selected wells":"Review assignment before commit"}</h3>${warnings.length?`<div class="error">Non-numeric selected wells: ${escapeHtml(warnings.join(", "))}. They will be flagged and never used as ordinary numeric measurements.</div>`:""}
   <div class="table-wrap"><table><thead><tr><th>Well</th><th>Reading</th><th>Role</th><th>Include</th><th>Standard curve</th><th>Concentration</th><th>Sample</th><th>Replicate group</th><th>Dilution</th><th>Exclusion reason</th></tr></thead><tbody>${p.draft.map((x,i)=>{const a=x.annotation;return `<tr data-i="${i}"><td>${x.well}</td><td>${escapeHtml(x.reading?.raw_value??"empty")} (${x.reading?.measurement_status||"empty"})</td><td><select data-key="role">${["standard","unknown","blank","ignore","unassigned"].map(v=>`<option ${a.role===v?"selected":""}>${v}</option>`).join("")}</select></td><td><input data-key="include" type="checkbox" ${a.include?"checked":""}></td><td>${previewCurveControl(a)}</td><td><input data-key="nominal_concentration" type="number" step="any" value="${a.nominal_concentration??""}"></td><td><input data-key="sample_id" value="${escapeHtml(a.sample_id)}"></td><td><input data-key="replicate_group" value="${escapeHtml(a.replicate_group)}"></td><td><input data-key="dilution_factor" type="number" step="any" value="${a.dilution_factor??""}"></td><td><input data-key="exclusion_reason" value="${escapeHtml(a.exclusion_reason)}"></td></tr>`}).join("")}</tbody></table></div><div class="row"><button id="commit-assignment" class="primary">Save selected wells</button><button id="cancel-assignment">Cancel</button></div></div>`;
  document.querySelectorAll('#assignment-preview tbody select[data-key="role"]').forEach(select=>select.onchange=()=>{
    const row=select.closest("tr"),curveControl=row.querySelector('[data-key="curve_id"]'),include=row.querySelector('[data-key="include"]');
    if(select.value==="unassigned"||select.value==="ignore")include.checked=false;
    else if(!include.checked&&!row.querySelector('[data-key="exclusion_reason"]').value.trim())include.checked=true;
    const curveId=curveControl.value||Object.keys(state.layout.curves)[0]||"";
    curveControl.closest("td").innerHTML=previewCurveControl({role:select.value,curve_id:curveId});
  });
  $("commit-assignment").onclick=commitAssignment;$("cancel-assignment").onclick=()=>{state.preview=null;$("assignment-preview").innerHTML=""};}
function commitAssignment(){const rows=[...document.querySelectorAll("#assignment-preview tbody tr")],draft={...state.layout.annotations};const errors=[],nonNumeric=[];
  for(const tr of rows){const item=state.preview.draft[Number(tr.dataset.i)],a={};for(const input of tr.querySelectorAll("[data-key]")){const key=input.dataset.key;a[key]=input.type==="checkbox"?input.checked:input.value.trim()}
    if(a.role==="unassigned"){delete draft[item.well];continue}
    if(a.role==="standard"&&a.nominal_concentration!==""){const n=Number(a.nominal_concentration);if(!Number.isFinite(n)||n<0)errors.push(`${item.well}: invalid concentration`);a.nominal_concentration=n}else a.nominal_concentration=null;
    if(a.role==="unknown"&&a.dilution_factor!==""){const n=Number(a.dilution_factor);if(!Number.isFinite(n)||n<=0)errors.push(`${item.well}: invalid dilution`);a.dilution_factor=n}else a.dilution_factor=null;
    if(a.role!=="ignore"&&!a.include&&!a.exclusion_reason)errors.push(`${item.well}: exclusion reason required`);
    if(a.role==="standard"&&(!a.curve_id||a.nominal_concentration===null))errors.push(`${item.well}: standard needs a standard curve and concentration`);
    if(a.role==="standard"&&a.curve_id&&!state.layout.curves[a.curve_id]&&state.preview.curve?.id!==a.curve_id)errors.push(`${item.well}: create the standard curve using Assign selected wells first`);
    if(a.role==="unknown"&&(!a.curve_id||!a.sample_id||a.dilution_factor===null))errors.push(`${item.well}: unknown needs a standard curve, sample and dilution`);
    if(a.role==="standard"){a.sample_id="";a.dilution_factor=null;if(item.annotation.role!=="standard"&&a.replicate_group===item.annotation.replicate_group)a.replicate_group=""}
    else if(a.role==="unknown"){a.nominal_concentration=null;if(item.annotation.role!=="unknown"&&a.replicate_group===item.annotation.replicate_group)a.replicate_group=a.sample_id}
    else{a.curve_id="";a.nominal_concentration=null;a.sample_id="";a.replicate_group="";a.dilution_factor=null}
    if(a.role==="ignore")a.include=false;
    if(a.include&&item.reading?.measurement_status!=="numeric"&&a.role!=="ignore")nonNumeric.push(item.well);
    draft[item.well]=a}
  const curvesWithStandards=new Set(Object.values(draft).filter(a=>a.role==="standard"&&a.include).map(a=>a.curve_id));
  for(const tr of rows){const item=state.preview.draft[Number(tr.dataset.i)],a=draft[item.well];if(a?.role==="unknown"&&(!curvesWithStandards.has(a.curve_id)||(!state.layout.curves[a.curve_id]&&state.preview.curve?.id!==a.curve_id)))errors.push(`${item.well}: choose a standard curve with assigned standard wells`)}
  if(errors.length)return showMessage("editor-message",errors.join("; "));
  saveHistory();state.layout.annotations=draft;if(state.preview.curve&&curvesWithStandards.has(state.preview.curve.id)){const c=state.preview.curve;state.layout.curves[c.id]={units:c.units}}
  state.result=null;state.preview=null;renderPlate();renderEditor();renderAnalysis();
  showMessage("editor-message",`${rows.length} well${rows.length===1?"":"s"} updated.${nonNumeric.length?` Check non-numeric wells: ${nonNumeric.join(", ")}.`:""}`,nonNumeric.length?"notice":"success");}
function renderCurveList(){const curves=Object.entries(state.layout.curves),counts={};for(const a of Object.values(state.layout.annotations))if(a.role==="standard"&&a.include)counts[a.curve_id]=(counts[a.curve_id]||0)+1;
  $("curve-list").innerHTML=curves.length?`<div class="table-wrap"><table><thead><tr><th>Standard curve ID</th><th>Assigned standard wells</th><th>Units</th><th></th></tr></thead><tbody>${curves.map(([id,c])=>`<tr><td>${escapeHtml(id)}</td><td>${counts[id]||0}${counts[id]?"":" — assign standards first"}</td><td><input data-curve-units="${escapeHtml(id)}" value="${escapeHtml(c.units)}"></td><td><button data-save-curve="${escapeHtml(id)}">Save</button></td></tr>`).join("")}</tbody></table></div>`:"<p class='hint'>No standard curves assigned yet.</p>";
  document.querySelectorAll("[data-save-curve]").forEach(b=>b.onclick=()=>{const id=b.dataset.saveCurve;saveHistory();state.layout.curves[id]={units:document.querySelector(`[data-curve-units="${CSS.escape(id)}"]`).value.trim()||"concentration units"};state.result=null;renderAnalysis();showMessage("editor-message",`Standard curve ${id} saved.`,"success")});}
async function loadLayoutFile(e){try{const file=e.target.files[0];if(!file)return;const raw=JSON.parse(await file.text()),checked=await api("/api/validate-layout",{imported:state.imported,layout:raw});if(checked.errors.length)throw Error(checked.errors.join("; "));state.pendingLayout=checked.layout;
  const annotations=Object.entries(checked.layout.annotations),oldMethod=raw.settings?.primary_method||"B",migration=(raw.version??1)===1?`<div class="notice">Older layout: Method ${escapeHtml(oldMethod)} is now called Method ${checked.layout.settings.primary_method}. The calculation stays the same.</div>`:"";$("layout-preview").innerHTML=`<div class="preview"><h3>Review saved layout</h3><p>${annotations.length} annotations, ${Object.keys(checked.layout.curves).length} standard curves.</p>${migration}${checked.warnings.length?`<div class="error">Measurement status changed: ${escapeHtml(checked.warnings.join("; "))}</div>`:"<div class='success'>Annotated well statuses match this export.</div>"}<p class="hint">Assignments and settings will replace the current map. Readings from the new workbook stay unchanged.</p><div class="table-wrap"><table><thead><tr><th>Well</th><th>Role</th><th>Standard curve</th><th>Concentration</th><th>Sample</th><th>Dilution</th></tr></thead><tbody>${annotations.map(([well,a])=>`<tr><td>${well}</td><td>${a.role}</td><td>${escapeHtml(a.curve_id)}</td><td>${a.nominal_concentration??""}</td><td>${escapeHtml(a.sample_id)}</td><td>${a.dilution_factor??""}</td></tr>`).join("")}</tbody></table></div><button id="apply-layout" class="primary">Apply saved layout</button><button id="cancel-layout">Cancel</button></div>`;
  $("apply-layout").onclick=()=>{saveHistory();state.layout=state.pendingLayout;state.pendingLayout=null;state.result=null;renderPlate();renderEditor();renderAnalysis()};$("cancel-layout").onclick=()=>{$("layout-preview").innerHTML="";state.pendingLayout=null};
 }catch(err){$("layout-preview").innerHTML=`<div class="error">${escapeHtml(err.message)}</div>`}}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function downloadLayout(){try{const layout=await api("/api/layout",{imported:state.imported,layout:state.layout});downloadBlob(new Blob([JSON.stringify(layout,null,2)],{type:"application/json"}),"elisa_layout.json")}catch(e){showMessage("editor-message",e.message)}}
function fmt(x,d=4){return x===null||x===undefined?"—":typeof x==="number"?Number(x).toPrecision(d):escapeHtml(x)}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${v??"—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`}
function renderAnalysis(){const root=$("analysis-root");if(!state.imported){root.innerHTML="<h2>3. Analyze and export</h2><p class='hint'>Import a workbook first.</p>";return}
  const s={blank_policy:"none",primary_method:"A",cv_warning_pct:20,recovery_min_pct:80,recovery_max_pct:120,max_rmse_od:.15,min_response_span_od:.05,...state.layout.settings};
  root.innerHTML=`<h2>3. Analyze and export</h2><div class="field-grid qc-fields">
    ${qcOptionField("Blank correction","s-blank",[["none","None"],["pooled","Subtract global plate blank mean"]],s.blank_policy)}
    ${qcOptionField("Primary sample method","s-method",[["A","A · average individual concentrations"],["B","B · invert mean replicate OD"]],s.primary_method,"Method A calculates a concentration for each valid replicate well, then averages those concentrations. Method B averages replicate OD first, then converts that mean to a concentration.")}
    ${qcNumberField("CV%","s-cv",s.cv_warning_pct,"Replicate coefficient of variation: sample standard deviation divided by the absolute mean, times 100. Standards are grouped by concentration. This threshold warns for standard OD replicates and for unknown sample replicate OD and calculated concentrations; it does not remove wells.")}
    ${qcNumberField("Recovery minimum %","s-rmin",s.recovery_min_pct,"For each positive standard well, recovery is the concentration calculated from the fitted curve divided by its assigned concentration, times 100. Recovery below this minimum fails standard curve QC.")}
    ${qcNumberField("Recovery maximum %","s-rmax",s.recovery_max_pct,"For each positive standard well, recovery is the concentration calculated from the fitted curve divided by its assigned concentration, times 100. Recovery above this maximum fails standard curve QC.")}
    ${qcNumberField("Maximum fit RMSE OD","s-rmse",s.max_rmse_od,"RMSE measures the typical difference between each usable standard well's corrected OD and the fitted curve OD. A value above this maximum fails standard curve QC.")}
    ${qcNumberField("Minimum standard OD spread","s-span",s.min_response_span_od,"Highest minus lowest corrected OD across all usable standard wells assigned to one curve. It compares readings across all concentration levels and replicates. A spread below this minimum fails standard curve QC.")}
  </div>
  <p class="hint">Software QC thresholds are exploratory and do not establish validated assay limits. Any included invalid replicate blanks its sample's primary result. Overflow is never converted to a numeric OD.</p><div class="row"><button id="run-analysis" class="primary">Run analysis</button><button id="download-report" ${state.result?"":"disabled"}>Download analysis workbook</button></div><div id="analysis-message"></div><div id="results"></div>`;
  root.querySelectorAll(".qc-help-button").forEach(button=>{button.addEventListener("pointerenter",()=>positionQcHelp(button));button.addEventListener("focus",()=>positionQcHelp(button))});
  $("run-analysis").onclick=runAnalysis;$("download-report").onclick=downloadReport;if(state.result)renderResults();}
function collectSettings(){const s={blank_policy:$("s-blank").value,primary_method:$("s-method").value,cv_warning_pct:Number($("s-cv").value),recovery_min_pct:Number($("s-rmin").value),recovery_max_pct:Number($("s-rmax").value),max_rmse_od:Number($("s-rmse").value),min_response_span_od:Number($("s-span").value)};if(Object.entries(s).some(([k,v])=>typeof v==="number"&&(!Number.isFinite(v)||v<0)))throw Error("QC thresholds must be finite nonnegative numbers.");return s}
async function runAnalysis(){try{state.layout.settings=collectSettings();$("run-analysis").disabled=true;showMessage("analysis-message","Analyzing…","success");state.result=await api("/api/analyze",{imported:state.imported,layout:state.layout});showMessage("analysis-message","");renderAnalysis()}catch(e){showMessage("analysis-message",e.message)}finally{if($("run-analysis"))$("run-analysis").disabled=false}}
async function downloadReport(){try{const blob=await api("/api/report",{imported:state.imported,layout:state.layout},true);downloadBlob(blob,"elisa_analysis.xlsx")}catch(e){showMessage("analysis-message",e.message)}}
function resultCell(w){if(!w||w.role==="ignore")return "—";
  if(w.role==="blank")return "BLANK";
  if(w.role==="standard")return `REF ${Number(w.nominal_concentration)}${w.measurement_status==="overflow"?" OVRFLW":""}`;
  if(w.well_adjusted_concentration!==null)return fmt(w.well_adjusted_concentration,7);
  if(w.result_status.startsWith("below_"))return "0";
  if(w.measurement_status==="overflow")return "OVRFLW";
  return w.result_status==="invalid_curve"?"QC FAIL":"—";
}
function renderResults(){const r=state.result,root=$("results"),byWell=Object.fromEntries(r.well_results.map(w=>[w.well,w])),byCurve=Object.fromEntries(r.curves.map(c=>[c.curve_id,c]));
  let html="<h3>Concentration plate</h3><p class='hint'>Unknowns show dilution-adjusted concentration. 0 means below the lowest tested standard, not a measured zero. REF is a standard's assigned concentration. Highlighted cells need QC review.</p>";
  html+=`<div class="table-wrap concentration-table"><table><thead><tr><th></th>${Array.from({length:12},(_,i)=>`<th>${i+1}</th>`).join("")}</tr></thead><tbody>`;
  for(const row of ROWS){html+=`<tr><th>${row}</th>`;for(let column=1;column<=12;column++){const well=row+column,w=byWell[well],label=resultCell(w),curveQc=byCurve[w?.curve_id]?.qc_status;html+=`<td class="${w?.role==="unknown"&&(w?.result_status!=="ok"||curveQc==="fail")?"result-flag":""}" title="${escapeHtml(`${well} · ${w?.sample_id||w?.role||"unassigned"} · ${w?.result_status||""} · curve QC ${curveQc||"—"} · dilution ${w?.dilution_factor??"—"}`)}">${label}</td>`}html+="</tr>"}html+="</tbody></table></div>";
  html+="<h3>Standard curve equations</h3><p class='hint'>x = measured concentration; y = blank-corrected OD. Each standard curve uses its own standards.</p>";
  for(const c of r.curves)html+=`<p><strong>${escapeHtml(c.curve_id)} (${c.model_type||"no fit"}):</strong> <code>${escapeHtml(c.fitted_equation||"Equation unavailable")}</code> <span class="${c.status==="valid"?"good":"bad"}">${c.status==="valid"?"FIT OK":"NO FIT"}</span> · <span class="${c.qc_status==="pass"?"good":"bad"}">QC ${escapeHtml(c.qc_status.toUpperCase())}</span></p>`;
  const needsAttention=r.errors.length||r.curves.some(c=>c.status!=="valid"||c.qc_status==="fail")||r.unknown_results.some(x=>x.status!=="quantified"||x.flags.length);
  html+=`<details ${needsAttention?"open":""}><summary>QC and detailed results${needsAttention?" · attention needed":""}</summary>`;
  if(r.errors.length)html+=`<div class="error">${escapeHtml(r.errors.join("; "))}</div>`;
  for(const c of r.curves){const plot=r.plots[c.curve_id],url=plot?URL.createObjectURL(new Blob([plot],{type:"image/svg+xml"})):null;html+=`<div class="curve-card"><h4>Standard curve ${escapeHtml(c.curve_id)} · <span class="${c.status==="valid"?"good":"bad"}">${c.status==="valid"?"FIT OK":"NO FIT"}</span> · <span class="${c.qc_status==="pass"?"good":"bad"}">QC ${escapeHtml(c.qc_status.toUpperCase())}</span></h4><p>${escapeHtml(c.units)} · ${c.n_levels} usable levels · ${c.n_wells} usable wells · fit ${c.fit_status}</p><p>Bottom ${fmt(c.parameters?.bottom)}, top ${fmt(c.parameters?.top)}, EC50 ${fmt(c.parameters?.ec50)}, slope ${fmt(c.parameters?.slope)}; RMSE ${fmt(c.rmse_od)} OD; R² ${fmt(c.r_squared)}; tested range ${fmt(c.range_low)}–${fmt(c.range_high)} ${escapeHtml(c.units)}.</p>${c.flags.length?`<div class="${c.qc_status==="fail"||c.status!=="valid"?"error":"notice"}">${escapeHtml(c.flags.join("; "))}</div>`:""}${url?`<img alt="${c.model_type} standard curve ${escapeHtml(c.curve_id)} plot" src="${url}">`:""}</div>`}
  html+="<h3>Unknown sample QC</h3>"+table(["Sample","Standard curve","Dilution","Valid/Included","Primary measured","Dilution-adjusted","Status and flags"],r.unknown_results.map(x=>[escapeHtml(x.sample_id),escapeHtml(x.curve_id),fmt(x.dilution_factor),`${x.n_valid}/${x.n}`,fmt(x.primary_measured_concentration),fmt(x.dilution_adjusted_concentration),`<span class="${x.status==="quantified"?"good":"bad"}">${x.status}</span> ${escapeHtml(x.flags.join("; "))}`]));
  html+="<h3>Standard levels and QC</h3>"+table(["Standard curve","Nominal","Usable/assigned","Wells","Readings/status","Mean OD","OD SD","CV %","Back-calculated by well","Recovery % by well","Residual OD by well","Flags"],r.standards_qc.map(x=>[escapeHtml(x.curve_id),fmt(x.nominal_concentration),`${x.n_usable}/${x.n_assigned}`,escapeHtml(x.wells),escapeHtml(x.readings+" · "+x.statuses),fmt(x.mean_corrected_od),fmt(x.sd_corrected_od),fmt(x.cv_pct),escapeHtml(x.back_calculated),escapeHtml(x.recovery_pct),escapeHtml(x.residual_od),escapeHtml(x.flags)]));
  html+="<h3>All 96 wells</h3>"+table(["Well","Reading","Role","Standard curve","Sample","Corrected OD","Measured","Dilution-adjusted","Result","Flags"],r.well_results.map(x=>[x.well,escapeHtml(x.raw_value??""),x.role,escapeHtml(x.curve_id),escapeHtml(x.sample_id),fmt(x.corrected_od),fmt(x.well_concentration),fmt(x.well_adjusted_concentration),escapeHtml(x.result_status),escapeHtml(x.flags.join("; "))]));
  root.innerHTML=html+"</details>";
}
async function finishImport(payload,sheetName){const imported=await api("/api/import",{...payload,...(sheetName?{sheet_name:sheetName}:{})});
  if(imported.requires_sheet_selection){$("sheet-choice").innerHTML=`<label class="field">Select OD reading sheet <select id="od-sheet">${imported.candidate_sheets.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}</select></label><button id="select-sheet" class="primary">Import selected sheet</button>`;$("select-sheet").onclick=async()=>{try{showMessage("import-warnings","Importing selected sheet…","success");await finishImport(payload,$("od-sheet").value)}catch(error){showMessage("import-warnings",error.message)}};showMessage("import-warnings","This workbook has multiple plate-shaped sheets. Choose the sheet with OD readings.","notice");return}
  state.imported=imported;state.layout={version:LAYOUT_VERSION,annotations:{},curves:{},settings:{}};state.selected.clear();state.history=[];state.result=null;$("sheet-choice").innerHTML="";$("file-info").textContent=`${imported.filename} · ${imported.sheet} · ${imported.imported_columns} imported columns (${imported.plate_columns?.join(", ")||"1–12"}) · 96-well view`;$("import-warnings").textContent=imported.warnings.join(" ");renderPlate();renderEditor();renderAnalysis()}
$("file").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{showMessage("import-warnings","Importing…","success");const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);await finishImport({filename:file.name,data_base64:btoa(binary)})}catch(err){state.imported=null;showMessage("import-warnings",err.message);renderPlate();renderEditor();renderAnalysis()}};
renderPlate();
renderEditor();renderAnalysis();
window.ELISA_APP_READY=true;
