<script type="text/javascript">
  console.log("HELLO, A11Y 2025-12-11");
  console.log("have jQuery?",$);
  console.log("have jQuery?",jQuery);
  // wth
  if (typeof $ === "undefined" && jQuery) {
  window.$ = jQuery;
}
  // Look for a main
  var $main = $("main, [role='main']");
  if ($main.length === 0) {
  console.log("This page needs a main");
  var $page = $("[data-elementor-type='wp-page']");
  if ($page.length) {
  console.log("page", $page);
  console.log("set page attr 'role'");
  $page.attr("role","main");
  $page.attr("id","content");
  console.log('page attr "role"',$page.attr("role"));
}
  else {
  console.error("No [data-elementor-type='wp-page'] found.");
}
}
  else {
  console.log("This page already has a main.");
}
  // WP puts the skip-link above all other content,
  // but it needs to be in a landmark, so move it.
  var $skipLink = $("a.skip-link");
  $skipLink.detach();
  var $banner = $("[role='banner']");
  $skipLink.prependTo($banner);
  $("[role='menubar']").removeAttr("role");
  $(".e-n-menu-title").removeAttr("role");
  $(".e-n-menu-wrapper").removeAttr("aria-labelledby");

  // text in title element should match text in h1
  // On Search Results page title says "You searched for xxxx"
  var $h1 = $("h1");
  console.log("h1",$h1);
  if ($h1.length) {
  var h1Text = $h1.text().trim().replace(/\s\s+/g," ");
  console.log(h1Text);
  if (h1Text.indexOf("Search results for:") !== -1) {
  $("title").text(h1Text+" | Wildlife Illinois");
}
  else if (h1Text.indexOf("Featured Topics") !== -1) {
  // on home page, h1 is weird like that.
  $("title").text("Wildlife Illinois Home | Featured Topics");
}
}

  var $faSearch = $("svg.fa-search").attr("role","img").attr("aria-label","search icon");

  $("a[aria-hidden=true]").attr("tabindex","-1");
  $("a[href='https://dnr.illinois.gov']").attr("tabindex","-1");
  const $navs = $("nav[aria-label=Menu]");
  console.log("found "+$navs.length+" navs with label Menu");
  if ($navs.length > 1) {
  $navs.each((idx,el) => {
    if (idx > 0) {
      $(el).attr("aria-label","Menu-"+(idx+1));
    }
  });
}

  $("svg[role=graphics-document]").attr("role","img");

  $("[aria-owns='select2-permit_type-filter-results']").attr("aria-label","Select animal");

  // Fix duplicate IDs introduced by Elementor by appending -2, -3, etc.
  var idCounts = {};
  $("[id]").each(function() {
    var id = this.id;
    if (idCounts[id] === undefined) {
      idCounts[id] = 1;
    } else {
      idCounts[id]++;
      this.id = id + "-" + idCounts[id];
      console.log("Duplicate ID renamed: " + id + " -> " + this.id);
    }
  });
  setTimeout(function() {
  console.log('$("#select2-zip-filter-container")',$("#select2-zip-filter-container"));
  $("#select2-zip-filter-container").css("overflow","inherit");
  $("#select2-zip-filter-container").attr("aria-label","Zip code");
},1000);

</script>
