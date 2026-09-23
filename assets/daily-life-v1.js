const enabled = book => book.stateSchema.some(d => d.id === 'life.dayReview');
const accountingStack=[];
export function withLifeAccounting(run) {
  accountingStack.push({served:0,revenue:0,cashSpent:0,newDebt:0});
  try{return run();}finally{accountingStack.pop();}
}
export function recordLifeOperations(state,operations) {
  const totals=accountingStack.at(-1);if(!totals)return;
  const copy={...state};
  for(const op of operations){
    const before=copy[op.target],after=op.type==='increment'?Number(before)+op.value:op.value;
    copy[op.target]=after;
    if(typeof before!=='number'||typeof after!=='number')continue;
    const delta=after-before;
    if(op.target==='shop.served')totals.served+=Math.max(0,delta);
    if(op.target==='shop.todayRevenue')totals.revenue+=Math.max(0,delta);
    if(op.target==='shop.coins')totals.cashSpent+=Math.max(0,-delta);
    if(op.target==='finance.arrears')totals.newDebt+=Math.max(0,delta);
  }
}
const steps = { observe:'观察状态', soothe:'安抚', brush:'梳理', clean:'清洁', rinse:'冲净', dry:'吹干', nails:'指甲护理', ears:'耳部护理', massage:'按摩', special:'特殊护理' };
const hours = { 商业街:[540,1260], 生鲜市场:[360,1080], 护理用品店:[540,1200], 社区服务中心:[540,1080], 白塔服务站:[540,1080] };
const visits = { zean:[540,1320], shen:[420,1320], jiang:[540,1080], ruan:[600,1260], murong:[600,1200], yelan:[1080,360] };
const inHours = (minute, [open,close]) => open < close ? minute >= open && minute < close : minute >= open || minute < close;
const clock = minute => String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
export function rhythm(state) {
  const minute = Number(state['time.minuteOfDay'] ?? 540);
  return minute<360?'深夜 · 街道安静，普通来客稀少':minute<540?'清晨 · 市集开摊，街区渐醒':minute<720?'上午 · 通勤与日常营业':minute<840?'午间 · 用餐与短暂休息':minute<1080?'下午 · 采购与日常来往':minute<1260?'傍晚 · 下班来客与晚间散步':'夜间 · 商铺陆续打烊，来客减少';
}
export function placeHours(state) {
  const place=state['world.location'], range=hours[place], minute=Number(state['time.minuteOfDay']??540);
  if(place==='一家护理小店')return state['shop.open']?'小店营业中，何时打烊由你决定':'小店已打烊，可自行安排生活';
  if(!range)return '当前可自由活动；星网商城全天可用';
  return place+' · '+clock(range[0])+'—'+clock(range[1])+' · '+(inHours(minute,range)?'日常营业时段':'已过日常营业时段，可在附近散步，星网商城仍可用');
}
function identity(state) {
  const guest=state['shop.currentGuest'];
  if(!guest||guest==='无')return null;
  const token=guest==='普通顾客'?state['guest.template']:guest;
  const reservation=state['booking.customerName'];
  const name=reservation&&reservation!=='无'?reservation:token==='首位顾客'?'林澄':token;
  // Unknown generated customers never inherit another generated customer's preferences.
  return {token,name,stable:!!name&&!['无','随机顾客','普通顾客'].includes(name)};
}
function write(book,snapshot,values,apply) {
  snapshot.state=apply(book,snapshot.state,Object.entries(values).map(([target,value])=>({type:'set',target,value})),false);
}
function refreshCare(book,before,next,observation,action,apply) {
  const who=identity(next.state), prior=identity(before.state);
  next.careMemories ??= [];
  const previous=before.careSession;
  const accepting=/^(accept_|care_accept_|retail\.booking\.accept)/.test(action||'');
  if(!who) {
    next.careSession=undefined;
    write(book,next,{'care.progress':'暂无正在护理的顾客','care.preferences':'暂无顾客偏好'},apply);
    return;
  }
  if(!next.careSession||accepting||!prior||previous?.token!==who.token||previous?.name!==who.name) {
    next.careSession={token:who.token,name:who.name,completed:[],note:'尚未记录护理进度'};
  }
  if(observation) {
    if(observation.guest!==who.token)throw new Error('护理记录与当前顾客不一致');
    next.careSession.completed=[...new Set([...next.careSession.completed,...observation.completed])];
    if(observation.note.trim())next.careSession.note=observation.note.trim();
    if(observation.preferences.length&&who.stable) {
      let memory=next.careMemories.find(m=>m.name===who.name);
      if(!memory) { memory={name:who.name,preferences:[],lastDay:next.state['time.day']};next.careMemories.push(memory); }
      memory.preferences=[...new Set([...memory.preferences,...observation.preferences.map(p=>p.trim()).filter(Boolean)])].slice(-8);
      memory.lastDay=next.state['time.day'];
      next.careMemories=next.careMemories.slice(-80);
    }
  }
  const current=next.careSession, memory=who.stable?next.careMemories.find(m=>m.name===who.name):null;
  write(book,next,{
    'care.progress':(current.completed.length?'已记录：'+current.completed.map(s=>steps[s]).join('、')+'。':'')+current.note,
    'care.preferences':memory?.preferences.length?memory.preferences.join('；'):'暂无已确认的长期偏好',
  },apply);
}
function dailyRecord(snapshot,day) {
  snapshot.dayRecords ??= [];
  let row=snapshot.dayRecords.find(r=>r.day===day);
  if(!row){row={day,served:0,revenue:0,cashSpent:0,newDebt:0,notes:[],review:''};snapshot.dayRecords.push(row);}
  return row;
}
function round(n){return Math.round(n*100)/100;}
function ledger(book,before,next,result,preClock,apply) {
  if(before.state['player.registered']===false)return;
  const oldDay=Number(before.state['time.day'])||1,newDay=Number(next.state['time.day'])||oldDay;
  const row=dailyRecord(next,oldDay), totals=accountingStack.at(-1);
  if(!totals)throw new Error('日回顾缺少本次账务记录');
  for(const field of ['served','revenue','cashSpent','newDebt'])row[field]=round(row[field]+totals[field]);
  // Keep short references to accepted story/system records, not an invented recap.
  const note=(result?.turnSummary?.trim()||((next.state['story.lastLog']!==before.state['story.lastLog'])?String(next.state['story.lastLog']??''):''));
  if(note&&!row.notes.includes(note.slice(0,180)))row.notes=[...row.notes,note.slice(0,180)].slice(-4);
  if(newDay>oldDay) {
    const appointments=(next.shopBookings??[]).filter(b=>b.status==='预约中'&&b.day===newDay).sort((a,b)=>a.time.localeCompare(b.time));
    const plans=appointments.length?appointments.slice(0,5).map(b=>b.time+' '+b.npc+' · '+b.productName).join('；')+(appointments.length>5?'；另有'+(appointments.length-5)+'笔':''):'暂无已登记预约';
    row.review='第'+oldDay+'天回顾\n接待 '+row.served+' 位 · 营业收入 '+row.revenue+' 星币\n现金支出 '+row.cashSpent+' 星币 · 新增欠费 '+row.newDebt+' 星币\n'+(row.notes.length?'今日记录：'+row.notes.join(' / ')+'\n':'')+'第'+newDay+'天预约（休息/换日时记录）：'+plans;
    write(book,next,{'life.dayReview':row.review},apply);
    dailyRecord(next,newDay);
  }
  next.dayRecords=next.dayRecords.slice(-30);
}
export function afterLifeTurn(book,before,next,result,preClock,apply) {
  if(!enabled(book))return next;
  if(result.careObservation&&!identity(next.state))throw new Error('当前没有可记录护理状态的顾客');
  refreshCare(book,before,next,result.careObservation,'',apply);
  ledger(book,before,next,result,preClock,apply);
  write(book,next,{'life.rhythm':rhythm(next.state),'life.placeHours':placeHours(next.state)},apply);
  return next;
}
export function lifeAction(book,before,panel,id,inputs,dispatch,apply) {
  return withLifeAccounting(()=>{
    const next=dispatch(book,before,panel,id,inputs);
    if(!enabled(book))return next;
    refreshCare(book,before,next,null,id,apply);
    ledger(book,before,next,null,null,apply);
    write(book,next,{'life.rhythm':rhythm(next.state),'life.placeHours':placeHours(next.state)},apply);
    return next;
  });
}
export function lifeEvents(book,snapshot,events) {
  if(!enabled(book))return events;
  const minute=Number(snapshot.state['time.minuteOfDay']??540),place=snapshot.state['world.location'];
  const closed=hours[place]&&!inHours(minute,hours[place]);
  return events.filter(event=>{
    if(event.id.startsWith('life_closed_'))return !!closed;
    if(closed&&event.id.startsWith('location_event_'))return false;
    const match=/^(return|intro)_(zean|shen|jiang|ruan|murong|yelan)$/.exec(event.id);
    // An established emergency introduction retains its original trigger rules.
    if(match&&event.id!=='intro_shen')return inHours(minute,visits[match[2]]);
    return true;
  }).map(event=>{
    if(event.id==='life_quiet_wait')return {...event,weight:minute<360||minute>=1260?100:minute<540||minute>=1080?30:3};
    if(/^guest_(new_|repeat_|dynamic_new)/.test(event.id)&&event.type==='random')return {...event,weight:minute<540||minute>=1260?1:event.weight};
    return event;
  });
}
export const lifePrompt='护理与生活记录协议：隐藏字段careObservation可记录本轮确实发生的护理变化，格式{guest:"当前身份键",completed:["observe/soothe/brush/clean/rinse/dry/nails/ears/massage/special中的实际项目"],note:"当前状态，如毛已洗净、尚未吹干",preferences:["本轮明确观察或告知的稳定偏好"]}。普通顾客身份键复制guest.template，核心顾客复制shop.currentGuest。只选已经实际做完的项目；提议、询价、将来计划、回忆上一单不算完成。没有新变化则省略字段。care.progress与care.preferences是程序保存的事实，后文必须延续；不得无故把已洗净写回满身灰，或把已放松写成刚开始害怕。completed记录本单已经做过什么，不代表动物永远不会重新弄脏；若正文实际有新变化，用note解释，不凭空回退。临时状态只属于本单，稳定偏好仅属于对应顾客，不可串客。preferences只追加稳定、具体且有依据的偏好，不把“刚洗完”或“今天很累”当永久偏好。不要在正文输出结构化字段。life.rhythm和life.placeHours描述游戏时段与当地营业，遵照营业时间描写街景与店员；非营业时间只能在附近活动或通过星网购买，不凭空让柜台营业。事件程序已按时段选择来客与场景，不得另造收费顾客。夜深来客减少不等于强制关店、睡觉或跳过剧情。life.dayReview是最新已结算日回顾，金额、接待数与预约须原样依据系统，不另编数字；可承接回顾但不重复扣款。';
