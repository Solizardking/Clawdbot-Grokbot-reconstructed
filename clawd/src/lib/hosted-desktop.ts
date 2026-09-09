/** Map a pointer through object-fit:contain; letterbox clicks are not actions. */
export function desktopPoint(x:number,y:number,width:number,height:number):{x:number;y:number}|null {
  if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)return null;
  const scale=Math.min(width/1280,height/800);
  const left=(width-1280*scale)/2,top=(height-800*scale)/2;
  const px=(x-left)/scale,py=(y-top)/scale;
  return px<0||py<0||px>=1280||py>=800?null:{x:Math.floor(px),y:Math.floor(py)};
}
