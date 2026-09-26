export function localDateTimeToEpoch(dateValue,timeValue,timeZone) {
 const [year,month,day]=dateValue.split('-').map(Number),[hour,minute]=timeValue.split(':').map(Number);
 const desired=Date.UTC(year,month-1,day,hour,minute);
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 let target=desired;
 for(let i=0;i<3;i++){
  const parts=Object.fromEntries(formatter.formatToParts(new Date(target)).map(part=>[part.type,part.value]));
  const represented=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute));
  const corrected=desired-(represented-target);if(corrected===target)break;target=corrected;
 }
 return target;
}
