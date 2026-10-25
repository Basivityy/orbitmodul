import { env } from "@/lib/env";
import { refreshPublicUrl } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";

/**
 * Store widget for any website (also Wix "Embed HTML"):
 *   <div data-orbitmodul-store="your-store"></div>
 *   <script src="https://PLATFORM/widget.js" async></script>
 * Options on the div: data-theme="light|dark", data-target="top|blank".
 */
export async function GET() {
  await refreshPublicUrl();
  const origin = env.appUrl.replace(/\/+$/, "");
  const js = `(function(){
  var ORIGIN=${JSON.stringify(origin)};
  function mount(el){
    if(el.getAttribute("data-om-mounted"))return;
    var slug=el.getAttribute("data-orbitmodul-store");if(!slug)return;
    el.setAttribute("data-om-mounted","1");
    var q="?theme="+encodeURIComponent(el.getAttribute("data-theme")||"dark")+"&target="+encodeURIComponent(el.getAttribute("data-target")||"top");
    var f=document.createElement("iframe");
    f.src=ORIGIN+"/embed/"+encodeURIComponent(slug)+q;
    f.title="Store";f.loading="lazy";f.setAttribute("scrolling","no");
    f.style.cssText="width:100%;border:0;min-height:420px;display:block;background:transparent";
    f.setAttribute("allowtransparency","true");
    el.appendChild(f);
    window.addEventListener("message",function(e){
      if(e.origin!==ORIGIN||e.source!==f.contentWindow)return;
      var d=e.data||{};if(d.type==="orbitmodul:height"&&d.height>0)f.style.height=Math.ceil(d.height)+"px";
    });
  }
  function run(){var n=document.querySelectorAll("[data-orbitmodul-store]");for(var i=0;i<n.length;i++)mount(n[i]);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);else run();
})();`;
  return new Response(js, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
