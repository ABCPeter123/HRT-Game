import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
class Dummy {
  constructor(id=''){this.id=id;this.value='';this.innerHTML='';this.textContent='';this.disabled=false;this.hidden=false;this.style={};this.listeners={};this.classList={toggle(){}};this.dataset={};}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  fire(type,payload={}){for(const fn of this.listeners[type]??[])fn({target:this,...payload});}
  setAttribute(){}closest(){return null;}insertAdjacentHTML(_,text){this.innerHTML+=text;}focus(){}
}
const elements=Object.fromEntries([...ids].map(id=>[id,new Dummy(id)]));
const defaults={'treasure-suit':'H','cash':'500','jokers':'0','trade-cash':'0','trade-jokers':'0','trade-contract-payout':'0','trade-contract-prob':'50','contract-payout':'100','contract-prob':'50','auction-number':'1','auction-kind':'joker','auction-payout':'100','auction-prob':'50','downside':'35','opponent-price':'50','opponent-direction':'buy','opponent-outcome':'offered'};
for(const [id,v] of Object.entries(defaults))elements[id].value=v;
const tabs=['hand','trade','auction','opponents'].map(value=>{const el=new Dummy();el.dataset.tab=value;return el;});
const workspaces=['hand','trade','auction','opponents'].map(value=>{const el=new Dummy('tab-'+value);return el;});
const modes=['add','remove'].map(value=>{const el=new Dummy();el.dataset.mode=value;return el;});
const storage=new Map();
globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
globalThis.document={addEventListener(){},getElementById:id=>{assert.ok(ids.has(id),`Missing HTML element ${id}`);return elements[id];},
 querySelectorAll:q=>q==='.tab'?tabs:q==='.workspace'?workspaces:q==='.mode-button'?modes:[]};
await import('../app.js');
test('module bootstraps with every referenced HTML ID present',()=>{
 assert.match(elements['best-move'].textContent,/ENTER YOUR HAND/);
 assert.equal(elements['score-exact'].textContent,'500');
});
test('paste hand and enter a favorable trade, then undo',()=>{
 elements['paste-cards'].value='AH AS';elements['replace-hand'].fire('click');
 assert.equal(JSON.parse(storage.get('quant-comp-treasures-v1')).rounds['1'].cards.length,2);
 assert.match(elements['best-move'].textContent,/TARGET/);
 elements['trade-receive'].value='AD';elements['trade-cash'].value='-60';elements['trade-cash'].fire('input');
 assert.match(elements['trade-result'].innerHTML,/FAVORABLE/);
 elements['confirm-trade'].fire('click');
 let round=JSON.parse(storage.get('quant-comp-treasures-v1')).rounds['1'];
 assert.equal(round.cards.length,3);assert.equal(round.cash,440);
 elements['undo'].fire('click');
 round=JSON.parse(storage.get('quant-comp-treasures-v1')).rounds['1'];
 assert.equal(round.cards.length,2);assert.equal(round.cash,500);
});
test('auction win deducts cash and adds one Joker',()=>{
 elements['auction-paid'].value='30';elements['record-win'].fire('click');
 const round=JSON.parse(storage.get('quant-comp-treasures-v1')).rounds['1'];
 assert.equal(round.cash,470);assert.equal(round.jokers,1);
});
