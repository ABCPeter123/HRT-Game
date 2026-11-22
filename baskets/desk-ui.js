/*
 * Local, two-person Baskets execution desk.
 * All communication uses explicit copy/paste; no chat or exchange backend.
 * Repricing observations are hypotheses until a human classifies them.
 */
import {SYMBOLS,validateBook,finite} from "./engine.js";
import {emptyDesk,createCall,teammateCallText,parseTeammateStatus,composeQuickReply,updateCall,
  observeRepricing,addPriceAlert,classifyPriceAlert,pendingAlerts,
  accountingSnapshot,undoReportedStatus} from "./desk-engine.js";

const $=id=>document.getElementById(id);
const escape=x=>String(x??"").replace(/[&<>"']/g,ch=>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const money=n=>Number.isFinite(Number(n))?"$"+Number(n).toFixed(2):"—";
const whole=n=>Number(n).toLocaleString("en-CA",{maximumFractionDigits:0});
const active=c=>!["FILLED","CANCELLED","REJECTED"].includes(c.status);
const timeString=t=>new Date(t).toLocaleTimeString("en-CA",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
export function createDeskUI({getState,getRound,getDecision,getCapture,save,refresh,onFlow,toast}) {
  let watches={},selectedAlertId=null,selectedSide=0,prompted=new Set(),lastQuoteRound=-1;
  let quickCallId=null,quickStatus="WORKING",quickQty="",quickPrice="";
  const currentDesk=()=>getRound().desk;
  function resetWatch(){
    watches={};selectedAlertId=null;selectedSide=0;prompted=new Set();
    $("signalPrompt").hidden=true;
    lastQuoteRound=getState().round;
    const now=Date.now();
    for(const sym of SYMBOLS){
      const first=observeRepricing(null,{symbol:sym,book:getRound().books[sym],at:now});
      if(first.state)watches[sym]=first.state;
    }
  }
  function tab(name){
    const selected=["desk","analysis","signals"].includes(name)?name:"desk";
    getState().workspaceTab=selected;
    for(const [key,id] of [["desk","deskView"],["signals","signalsView"],["analysis","analysisView"]]){
      $(id).hidden=key!==selected;
    }
    document.querySelectorAll("[data-workflow-tab]").forEach(button=>{
      const yes=button.dataset.workflowTab===selected;
      button.classList.toggle("active",yes);
      button.setAttribute("aria-selected",yes?"true":"false");
    });
    if(selected==="signals"){
      $("signalPrompt").hidden=true;
      renderSignals();
    }
    save();
  }
  function counters(){
    const r=getRound(),calls=r.desk?.calls||[];
    const count=calls.filter(active).length;
    const pending=pendingAlerts(r.desk||emptyDesk()).length;
    $("deskCounter").textContent=String(count);
    $("signalCounter").textContent=String(pending);
    $("ordersActiveCount").textContent=count+" ACTIVE";
    $("callHistoryCount").textContent=calls.length+" CALLS";
    $("signalPendingLabel").textContent=pending+" TO REVIEW";
    $("deskCounter").classList.toggle("needs-attention",count>0);
    $("signalCounter").classList.toggle("needs-attention",pending>0);
  }
  function renderRecommendation(decision=getDecision()){
    if(!decision)return;
    const best=decision.best;
    const capture=getCapture();
    $("deskFeedStatus").textContent=capture.active?
      ((3-(capture.staleSymbols||[]).length)+"/3 FRESH BOOKS"):"MANUAL INPUTS";
    const unresolved=(getRound().desk?.calls||[]).filter(active);
    const duplicate=best&&unresolved.some(c=>c.symbol===best.symbol&&c.side===best.side&&
      c.qty===best.qty&&c.price===best.price);
    $("callTeammate").disabled=!best||!!duplicate;
    $("callTeammate").textContent=!best?"No eligible call":
      duplicate?"Call already queued":"Copy instruction + queue call";
    const primary=best?
      '<div class="desk-live-action"><div><div class="desk-live-side '+(best.side==="BUY"?"buy":"sell")+'">'+
      escape(best.side+" "+best.symbol)+'</div><div class="desk-live-note">'+
      escape(best.kind==="TAKE"?"Marketable LIMIT order":"Passive LIMIT order")+' · '+
      escape(whole(best.qty))+' shares</div></div>'+
      '<div class="desk-live-details"><span>LIMIT PRICE</span><strong>'+money(best.price)+
      '</strong><span>Expected model edge '+money(best.unitEdge)+'/share</span></div></div>':
      '<div class="desk-live-action"><div><div class="desk-live-side hold">HOLD</div>'+
      '<div class="desk-live-note">No eligible order at current modeled prices.</div></div>'+
      '<div class="desk-live-details"><span>Quotes loaded</span><strong>'+
      (3-(decision.missing?.length||0))+' / 3</strong></div></div>';
    const alternatives=(decision.alternatives||[]).slice(0,3).map(a=>
      '<span>'+escape(a.side+" "+a.symbol+" "+whole(a.qty))+' @ '+money(a.price)+'</span>').join("");
    $("deskLiveRecommendation").innerHTML=primary+
      '<div class="desk-live-note">'+(duplicate?
        'The same unresolved order is already in your handoff queue. Wait for your teammate or update its status.':
        'This is an opportunity estimate, not an execution guarantee. Check current quotes before relaying it.')+
      (capture.active&&(capture.staleSymbols||[]).length?
        ' Live capture is stale or missing for '+escape(capture.staleSymbols.join(", "))+'. Those books are excluded from new calls.':"")+
      '</div>'+
      (alternatives?'<div class="desk-live-alternatives">'+alternatives+'</div>':"");
    counters();
  }
  function renderCallCard(call){
    const closed=!active(call);
    const progress=call.qty?Math.round(100*(call.filledQty||0)/call.qty):0;
    return '<article class="desk-call">'+
      '<div class="desk-call-top"><span class="desk-call-id">'+escape(call.id)+'</span>'+
      '<span class="desk-call-status '+escape(call.status.toLowerCase())+'">'+escape(call.status)+'</span></div>'+
      '<div class="desk-call-title">'+escape(call.side+" "+call.qty+" "+call.symbol)+
      ' LIMIT '+money(call.price)+'</div>'+
      '<div class="desk-call-summary">Called '+escape(timeString(call.createdAt))+
      ' · '+escape(call.kind)+" · "+whole(call.filledQty||0)+"/"+whole(call.qty)+
      ' filled ('+progress+'%)'+
      (call.avgFill!==null?' · Avg '+money(call.avgFill):'')+
      '</div>'+
      '<div class="desk-call-actions">'+
      '<button type="button" class="button ghost small" data-copy-call="'+escape(call.id)+'">Copy instruction</button>'+
      (!closed?
      (call.status==="CALLED"?'<button type="button" class="button small" data-call-status="ACK" data-call-id="'+escape(call.id)+'">Acknowledged</button>':"")+
      (["CALLED","ACK"].includes(call.status)?'<button type="button" class="button small" data-call-status="WORKING" data-call-id="'+escape(call.id)+'">Order working</button>':"")+
      '<button type="button" class="button ghost small" data-call-status="CANCELLED" data-call-id="'+escape(call.id)+'">Cancelled</button>'+
      ((call.filledQty||0)===0?'<button type="button" class="button ghost small" data-call-status="REJECTED" data-call-id="'+escape(call.id)+'">Rejected</button>':""):"")+
      '</div>'+
      (!closed?'<div class="desk-call-update">'+
      '<label>Cumulative filled shares<input type="number" min="1" max="'+call.qty+'" step="1" inputmode="numeric" '+
      'data-report-qty="'+escape(call.id)+'" placeholder="'+call.qty+'"></label>'+
      '<label>Reported average fill price<input type="number" min="0" max="800" step="any" inputmode="decimal" '+
      'data-report-price="'+escape(call.id)+'" placeholder="Actual avg price"></label>'+
      '<button type="button" class="button secondary" data-call-status="PARTIAL" data-call-id="'+escape(call.id)+'">Partial fill</button>'+
      '<button type="button" class="button secondary" data-call-status="FILLED" data-call-id="'+escape(call.id)+'">Fully filled</button>'+
      '</div>':"")+'</article>';
  }
  const QUICK_STATUSES=[
    ["ACK","Acknowledged"],["WORKING","Order working"],
    ["PARTIAL","Partially filled"],["FILLED","Fully filled"],
    ["CANCELLED","Cancelled"],["REJECTED","Rejected"]
  ];
  function quickOrder(){
    return (currentDesk().calls||[]).find(c=>c.id===quickCallId&&active(c))||null;
  }
  function quickReport(){
    return composeQuickReply(quickOrder(),{
      status:quickStatus,qty:quickQty===""?null:Number(quickQty),
      price:quickPrice===""?null:Number(quickPrice)
    });
  }
  function previewQuick(){
    const order=quickOrder();
    const preview=$("quickPreview"),error=$("quickError");
    if(!order){
      preview.textContent="Queue an order above to begin.";
      error.textContent="";$("quickApply").disabled=true;$("quickCopy").disabled=true;
      return;
    }
    try{
      const result=quickReport();
      preview.textContent=result.text;
      error.textContent="";
      $("quickApply").disabled=false;$("quickCopy").disabled=false;
    }catch(err){
      preview.textContent=order.id+" "+quickStatus+
        (["PARTIAL","FILLED"].includes(quickStatus)?" [shares] @ [actual average price]":"");
      error.textContent=err.message;
      $("quickApply").disabled=true;$("quickCopy").disabled=true;
    }
  }
  function renderQuickBuilder(){
    const open=(currentDesk().calls||[]).filter(active).slice().reverse();
    const selector=$("quickCallId");
    if(!open.some(c=>c.id===quickCallId)){
      quickCallId=open[0]?.id||null;
      quickStatus=quickOrder()?.filledQty?"PARTIAL":"WORKING";
      quickQty="";quickPrice="";
    }
    const order=quickOrder();
    selector.innerHTML=open.length?
      open.map(c=>'<option value="'+escape(c.id)+'">'+
        escape(c.id+" · "+c.side+" "+c.qty+" "+c.symbol+" · "+c.status)+
        '</option>').join(""):
      '<option value="">No active orders</option>';
    selector.value=order?.id||"";
    selector.disabled=!order;
    const filled=order?.filledQty||0;
    const allowed=status=>order&&
      !(status==="ACK"&&!["CALLED","ACK"].includes(order.status))&&
      !(status==="WORKING"&&filled>0)&&
      !(status==="REJECTED"&&filled>0)&&
      !(status==="PARTIAL"&&filled>=order.qty-1);
    $("quickStatusButtons").innerHTML=QUICK_STATUSES.map(([status,label])=>
      '<button type="button" data-quick-status="'+status+'" class="quick-status-button '+
      (quickStatus===status?"selected":"")+'" aria-pressed="'+(quickStatus===status)+
      '" '+(!allowed(status)?"disabled":"")+'>'+label+'</button>').join("");
    if(!allowed(quickStatus))quickStatus=filled>0?"PARTIAL":"WORKING";
    // Refresh the selected highlight if switching to a valid fallback.
    $("quickStatusButtons").querySelectorAll("button").forEach(b=>{
      const selected=b.dataset.quickStatus===quickStatus;
      b.classList.toggle("selected",selected);
      b.setAttribute("aria-pressed",String(selected));
    });
    const isFill=["PARTIAL","FILLED"].includes(quickStatus);
    $("quickFillFields").hidden=!isFill;
    if(isFill&&order){
      if(quickStatus==="FILLED")quickQty=String(order.qty);
      $("quickQty").value=quickQty;
      $("quickQty").min=String(filled);
      $("quickQty").max=String(order.qty);
      $("quickQty").readOnly=quickStatus==="FILLED";
      $("quickPrice").value=quickPrice;
      $("quickQtyButtons").innerHTML=[["25%","25"],["50%","50"],["75%","75"],["All","100"],
        ["−1","minus"],["+1","plus"]].map(([label,val])=>
        '<button type="button" class="button small ghost" data-quick-qty="'+val+
        '" '+(quickStatus==="FILLED"?"disabled":"")+'>'+label+'</button>').join("");
    }
    $("quickUseLimit").textContent=order?
      "Use "+money(order.price)+" limit as verified fill price":"Use order limit as actual fill price";
    previewQuick();
  }
  function renderCalls(){
    const rows=(currentDesk().calls||[]).slice().reverse();
    rows.sort((a,b)=>Number(active(b))-Number(active(a))||b.createdAt-a.createdAt);
    $("deskCallList").innerHTML=rows.length?
      '<div class="desk-call-list">'+rows.slice(0,20).map(renderCallCard).join("")+'</div>':
      '<div class="desk-call-empty">No calls yet. Once a live recommendation is available, copy it to your teammate and track the response here.</div>';
    $("undoTeammateStatus").disabled=!(currentDesk().audit||[]).length;
    renderQuickBuilder();
    counters();
  }
  async function copyToClipboard(message){
    try{
      await navigator.clipboard.writeText(message);
      $("copyFallback").hidden=true;
      toast("Copied. Send this message to your teammate.");
      return true;
    }catch{
      $("copyFallback").hidden=false;
      $("copyFallbackText").value=message;
      $("copyFallbackText").focus();$("copyFallbackText").select();
      toast("Clipboard unavailable. Copy the visible message manually.");
      return false;
    }
  }
  async function callTeammate(){
    const best=getDecision()?.best;
    if(!best){toast("No qualified trade recommendation right now.");return;}
    const previous=currentDesk();
    if(previous.calls.some(c=>active(c)&&c.symbol===best.symbol&&c.side===best.side&&
      c.qty===best.qty&&c.price===best.price)){
      toast("That exact trade is already queued. Update its status first.");return;
    }
    try{
      const result=createCall(previous,best,getState().round+1);
      getRound().desk=result.desk;save();renderCalls();renderRecommendation();
      await copyToClipboard(teammateCallText(result.call));
    }catch(error){toast(error.message);}
  }
  function report(id,update){
    const r=getRound(),calls=r.desk.calls||[];
    const index=calls.findIndex(x=>x.id===id);
    if(index<0)throw new Error("Unknown call "+id+". Switch to its competition round first.");
    const call=calls[index];
    const captured=getCapture();
    const previous={...r.books[call.symbol]};
    const result=updateCall(previous,call,update,{
      livePosition:captured.active&&captured.positions.has(call.symbol),
      liveOrders:captured.active&&captured.orders.has(call.symbol)
    });
    if(!result.changed){
      toast("Status already recorded. No duplicate fill applied.");return;
    }
    r.books[call.symbol]=result.book;
    r.desk.calls[index]=result.call;
    r.desk.audit=(r.desk.audit||[]).concat([{
      id,priorCall:{...call},afterCall:{...result.call},
      beforeLedger:accountingSnapshot(previous),
      afterLedger:accountingSnapshot(result.book),
      fillAdded:result.fillDelta>0,fillQty:result.fillDelta
    }]).slice(-30);
    if(result.fillDelta>0){
      const executionPrice=Math.round(result.notionalDelta/result.fillDelta*100)/100;
      r.fills.push({
        sym:call.symbol,side:call.side,qty:result.fillDelta,price:executionPrice,
        previous,viaDesk:true,orderId:id,previousCall:call,at:Date.now()
      });
      r.fills=r.fills.slice(-200);
    }
    save();renderCalls();renderRecommendation();
    refresh();
    toast(id+": "+result.call.status+
      (result.fillDelta?" · "+result.fillDelta+" new executed shares":""));
  }
  function undoLastReport(){
    const r=getRound(),logs=r.desk.audit||[];
    const last=logs.at(-1);
    if(!last){toast("No teammate status to correct.");return;}
    const index=r.desk.calls.findIndex(c=>c.id===last.id);
    if(index<0){toast("The original call is missing.");return;}
    if(last.fillAdded){
      const recorded=r.fills.at(-1);
      if(!recorded||!recorded.viaDesk||recorded.orderId!==last.id||
        recorded.qty!==last.fillQty){
        toast("Another fill was recorded afterward. Cannot safely undo this report.");return;
      }
    }
    try{
      const restored=undoReportedStatus(r.books[r.desk.calls[index].symbol],
        r.desk.calls[index],{
          id:last.id,beforeCall:last.priorCall,afterCall:last.afterCall,
          beforeLedger:last.beforeLedger,afterLedger:last.afterLedger
        });
      if(!window.confirm("Correct the latest LOCAL teammate status ("+last.id+
        ")? This does not cancel or reverse any real exchange trade."))return;
      r.books[r.desk.calls[index].symbol]=restored.book;
      r.desk.calls[index]=restored.call;
      r.desk.audit.pop();
      if(last.fillAdded)r.fills.pop();
      save();renderCalls();renderRecommendation();refresh();
      toast("Local report reverted. Enter the correct teammate update.");
    }catch(error){toast(error.message);}
  }

  function safeReport(id,update){
    try{report(id,update);return true;}
    catch(error){toast(error.message);return false;}
  }
  function reportFromText(text){
    try{
      const parsed=parseTeammateStatus(text);
      return safeReport(parsed.id,parsed);
    }catch(error){toast(error.message);return false;}
  }
  function desktopAlertStatus(){
    const status=$("desktopAlertStatus");
    const supported=typeof Notification!=="undefined";
    const permission=supported?Notification.permission:"unsupported";
    status.textContent=permission==="granted"?
      "Desktop notifications enabled. Alerts may appear when the game tab is active.":
      permission==="denied"?
      "Desktop notifications blocked by Chrome. The in-app queue still works.":
      supported?
      "In-app alerts always work. Click Enable desktop notifications to request browser permission.":
      "This browser does not support desktop notifications here. In-app alerts remain available.";
    $("enableDesktopAlerts").disabled=permission==="granted"||!supported;
  }
  async function enableDesktopNotifications(){
    if(typeof Notification==="undefined"){toast("Desktop notifications are not supported here.");return;}
    try{
      const permission=await Notification.requestPermission();
      desktopAlertStatus();
      toast(permission==="granted"?
        "Desktop alerts enabled for this browser.":"Desktop alerts unavailable. The in-app alert queue remains active.");
    }catch{toast("Chrome did not allow notification permission here.");}
  }
  function notifyDesktop(alert){
    if(typeof Notification==="undefined"||Notification.permission!=="granted"||!document.hidden)return;
    try{
      const notification=new Notification("Baskets: "+alert.symbol+" repriced "+(alert.delta>0?"UP":"DOWN"),{
        body:money(alert.from)+" → "+money(alert.to)+". Review possible event activity.",
        tag:"baskets-"+alert.id
      });
      notification.onclick=()=>{
        try{window.focus();selectAlert(alert.id);notification.close();}catch{}
      };
    }catch{
      // Chrome may prohibit notifications even after permission. Keep in-app queue.
    }
  }

  function openPrompt(alert){
    if(!alert||prompted.has(alert.id))return;
    $("signalPromptTitle").textContent=alert.symbol+" moved "+(alert.delta>0?"UP":"DOWN");
    $("signalPromptDetails").textContent=alert.symbol+" midpoint "+money(alert.from)+" → "+
      money(alert.to)+" ("+(alert.delta>0?"+":"")+money(alert.delta)+") over "+
      (alert.windowMs/1000).toFixed(1)+"s. Was this event-bot activity or ordinary repricing?";
    $("signalPrompt").dataset.alertId=alert.id;
    $("signalPrompt").hidden=false;
    notifyDesktop(alert);
  }
  function selectAlert(id){
    const a=currentDesk().alerts.find(x=>x.id===id);
    if(!a){toast("Alert no longer available.");return;}
    selectedAlertId=a.id;selectedSide=0;
    $("signalPrompt").hidden=true;
    tab("signals");renderSignals();
    $("signalInspector").scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  function renderSignals(){
    const alerts=(currentDesk().alerts||[]).slice().reverse();
    alerts.sort((a,b)=>Number(b.status==="PENDING")-Number(a.status==="PENDING")||b.at-a.at);
    $("signalHistory").innerHTML=alerts.length?alerts.map(a=>{
      const movement=(a.delta>0?"+":"")+money(a.delta);
      return '<div class="signal-card"><div><strong>'+escape(a.symbol)+'</strong> '+
        '<span class="signal-change '+(a.delta>0?"up":"down")+'">'+movement+'</span>'+
        '<div><span>'+money(a.from)+" → "+money(a.to)+' · '+escape(timeString(a.at))+
        ' · '+escape(a.classification||"Needs review")+'</span></div></div>'+
        '<button type="button" class="button small '+(a.status==="PENDING"?"secondary":"ghost")+
        '" data-open-alert="'+escape(a.id)+'">'+(a.status==="PENDING"?"Review":"Details")+'</button></div>';
    }).join(""):'<p class="hint">No repricing alerts yet. Add live or manual quotes and enable this panel to monitor quick midpoint moves.</p>';
    renderInspector();counters();
  }
  function renderInspector(){
    const alert=currentDesk().alerts.find(x=>x.id===selectedAlertId);
    if(!alert){
      $("signalInspector").innerHTML='<p class="hint">Select a pending price alert to classify the movement. No event flow is assumed from price movement alone.</p>';
      return;
    }
    const title='<div class="signal-detail">'+escape(alert.symbol)+": "+
      money(alert.from)+" → "+money(alert.to)+
      ' <span>('+escape(alert.windowMs/1000)+" seconds)</span></div>";
    if(alert.status!=="PENDING"){
      $("signalInspector").innerHTML=title+'<p class="hint">Reviewed as <strong>'+
        escape(alert.classification)+'</strong>'+
        (alert.volume!==null?' · Logged '+(alert.volume>0?"+":"")+whole(alert.volume)+" observed shares":" · No volume logged")+
        '. This classification is saved and cannot be double-counted.</p>';return;
    }
    $("signalInspector").innerHTML=title+
      '<p class="hint">Select the trade direction you actually observed, not the price direction. Enter share volume from a tape or identified trade. Never infer event-bot Q directly from a price move.</p>'+
      '<div class="signal-confirm"><div class="eyebrow">OBSERVED TRADE SIDE</div>'+
      '<div class="signal-side-choices"><button type="button" data-alert-side="1" class="'+
      (selectedSide===1?"selected":"")+'">Buyer-initiated (+)</button>'+
      '<button type="button" data-alert-side="-1" class="'+(selectedSide===-1?"selected":"")+
      '">Seller-initiated (−)</button></div>'+
      '<label for="alertQuantity">Observed executed shares (not an estimate from price)</label>'+
      '<input id="alertQuantity" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 50">'+
      '<div class="desk-primary-actions">'+
      '<button type="button" class="button secondary" data-classify-alert="suspected">Suspected event</button>'+
      '<button type="button" class="button ghost" data-classify-alert="confirmed">Confirmed event</button>'+
      '<button type="button" class="button ghost" data-classify-alert="tape">Ordinary public tape</button>'+
      '</div><p class="hint">Confirmed event should be used only when the event bot is reliably identified. Suspected uses your confidence setting; public tape never moves modeled settlement.</p>'+
      '<div class="desk-primary-actions"><button type="button" class="button ghost" data-classify-alert="reviewed">Reviewed, no volume evidence</button>'+
      '<button type="button" class="button ghost" data-classify-alert="dismissed">Dismiss signal</button></div></div>';
  }
  function classify(kind){
    const r=getRound(),i=r.desk.alerts.findIndex(x=>x.id===selectedAlertId);
    if(i<0){toast("Select an alert first.");return;}
    const alert=r.desk.alerts[i];
    try{
      const volume=$("alertQuantity")?.value;
      const result=classifyPriceAlert(alert,kind,{
        direction:selectedSide,volume:volume===""?null:Number(volume)
      });
      r.desk.alerts[i]=result;save();renderSignals();
      if(["confirmed","suspected","tape"].includes(kind)){
        onFlow(alert.symbol,kind,result.volume,alert.id);
      }
      toast(kind==="reviewed"||kind==="dismissed"?
        "Price movement recorded without adding any event volume.":
        "Logged "+(result.volume>0?"+":"")+whole(result.volume)+" "+kind+" shares for "+alert.symbol+".");
    }catch(error){toast(error.message);}
  }
  function onQuoteUpdate(symbols){
    const r=getRound(),now=Date.now();
    let created=false;
    for(const sym of symbols){
      if(!SYMBOLS.includes(sym))continue;
      const observed=observeRepricing(watches[sym],{
        symbol:sym,book:r.books[sym],at:now,thresholdTicks:getState().alertTicks||3
      });
      if(observed.state)watches[sym]=observed.state;
      if(!observed.alert)continue;
      const result=addPriceAlert(r.desk,observed.alert,getState().round+1);
      r.desk=result.desk;save();
      created=true;openPrompt(result.alert);
    }
    if(created)renderSignals();
  }
  function renderAll(){
    if(lastQuoteRound!==getState().round)resetWatch();
    desktopAlertStatus();
    $("alertTicks").value=String(getState().alertTicks||3);
    tab(getState().workspaceTab||"desk");
    renderCalls();renderSignals();renderRecommendation();
  }
  document.addEventListener("click",async event=>{
    const button=event.target.closest("button");if(!button)return;
    if(button.dataset.workflowTab)return tab(button.dataset.workflowTab);
    if(button.id==="openAnalysis")return tab("analysis");
    if(button.id==="enableDesktopAlerts")return enableDesktopNotifications();
    if(button.id==="undoTeammateStatus")return undoLastReport();
    if(button.dataset.quickStatus){
      quickStatus=button.dataset.quickStatus;
      if(quickStatus==="FILLED"&&quickOrder())quickQty=String(quickOrder().qty);
      if(quickStatus==="PARTIAL"&&quickOrder()&&Number(quickQty)>=quickOrder().qty)quickQty="";
      renderQuickBuilder();return;
    }
    if(button.dataset.quickQty){
      const order=quickOrder();if(!order)return;
      const current=Number(quickQty)||order.filledQty||0;
      const value=button.dataset.quickQty;
      const proposed=value==="plus"?current+1:value==="minus"?current-1:
        Math.ceil(order.qty*Number(value)/100);
      const safe=Math.max(order.filledQty+1,Math.min(order.qty-1,proposed));
      if(safe>order.filledQty&&safe<order.qty)quickQty=String(safe);
      else toast("Choose a partial quantity between previous filled shares and the total.");
      renderQuickBuilder();return;
    }
    if(button.id==="quickUseLimit"){
      const order=quickOrder();if(!order)return;
      quickPrice=String(order.price);$("quickPrice").value=quickPrice;
      previewQuick();return;
    }
    if(button.dataset.priceAdjust){
      if(quickPrice===""){toast("Select a fill price first.");return;}
      const value=Number(quickPrice)+Number(button.dataset.priceAdjust);
      if(value<0||value>800){toast("Price must be between $0 and $800.");return;}
      quickPrice=String(Math.round(value*100)/100);$("quickPrice").value=quickPrice;
      previewQuick();return;
    }
    if(button.id==="quickApply"||button.id==="quickCopy"){
      try{
        const result=quickReport();
        if(button.id==="quickCopy")await copyToClipboard(result.text);
        else safeReport(result.update.id,result.update);
      }catch(err){toast(err.message);}
      return;
    }

    if(button.id==="callTeammate")return callTeammate();
    if(button.dataset.copyCall){
      const call=currentDesk().calls.find(c=>c.id===button.dataset.copyCall);
      if(call)await copyToClipboard(teammateCallText(call));
      return;
    }
    if(button.dataset.callStatus){
      const id=button.dataset.callId,status=button.dataset.callStatus;
      const qtyField=document.querySelector('[data-report-qty="'+id+'"]');
      const priceField=document.querySelector('[data-report-price="'+id+'"]');
      const qty=["PARTIAL","FILLED"].includes(status)?Number(qtyField?.value):null;
      const price=["PARTIAL","FILLED"].includes(status)?Number(priceField?.value):null;
      if(["PARTIAL","FILLED"].includes(status)&&(!qtyField?.value||!priceField?.value)){
        toast("Enter cumulative filled shares and actual average fill price.");return;
      }
      return safeReport(id,{status,qty,price});
    }
    if(button.id==="applyTeammateReply"){
      if(reportFromText($("teammateReply").value))$("teammateReply").value="";
      return;
    }
    if(button.id==="pasteTeammateReply"){
      try{$("teammateReply").value=await navigator.clipboard.readText();}
      catch{toast("Clipboard unavailable. Paste the teammate's reply manually.");}
      return;
    }
    if(button.dataset.openAlert)return selectAlert(button.dataset.openAlert);
    if(button.id==="reviewSignalNow")return selectAlert($("signalPrompt").dataset.alertId);
    if(button.id==="deferSignal"){
      prompted.add($("signalPrompt").dataset.alertId);
      $("signalPrompt").hidden=true;return;
    }
    if(button.dataset.alertSide){
      selectedSide=Number(button.dataset.alertSide);
      document.querySelectorAll("[data-alert-side]").forEach(el=>
        el.classList.toggle("selected",Number(el.dataset.alertSide)===selectedSide));
      return;
    }
    if(button.dataset.classifyAlert)return classify(button.dataset.classifyAlert);
  });
  document.addEventListener("input",event=>{
    if(event.target.id==="quickQty"){quickQty=event.target.value;previewQuick();}
    if(event.target.id==="quickPrice"){quickPrice=event.target.value;previewQuick();}
  });
  document.addEventListener("change",event=>{
    if(event.target.id==="quickCallId"){
      quickCallId=event.target.value;quickStatus=quickOrder()?.filledQty?"PARTIAL":"WORKING";
      quickQty="";quickPrice="";renderQuickBuilder();return;
    }
    if(event.target.id==="alertTicks"){
      getState().alertTicks=[2,3,4,6].includes(Number(event.target.value))?
        Number(event.target.value):3;
      save();toast("Price alert threshold saved.");
    }
  });
  return {renderAll,renderRecommendation,renderCalls,renderSignals,tab,onQuoteUpdate,
    resetWatch,safeReport};
}
