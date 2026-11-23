// Rate pages: count clicks to the form, and send rate-change alert signups to Supabase.
(function () {
  function track(event, props) {
    if (window.plausible) window.plausible(event, props ? { props: props } : undefined);
  }
  var where = location.pathname;
  document.querySelectorAll("[data-track]").forEach(function (el) {
    el.addEventListener("click", function () {
      track(el.getAttribute("data-track"), { page: where });
    });
  });
  document.querySelectorAll("form[data-alert]").forEach(function (form) {
    var status = form.querySelector(".alert-status");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = new FormData(form);
      var body = {
        email: String(data.get("email") || "").trim(),
        trade: String(data.get("trade") || ""),
        crew_size: String(data.get("crew") || ""),
        wd: form.getAttribute("data-wd") || null,
        state: form.getAttribute("data-state"),
        county: form.getAttribute("data-county") || null,
        page: where,
      };
      var button = form.querySelector("button");
      button.disabled = true;
      status.textContent = "Saving…";
      fetch(form.getAttribute("data-supabase") + "/rest/v1/rate_alerts", {
        method: "POST",
        headers: {
          apikey: form.getAttribute("data-key"),
          "content-type": "application/json",
          prefer: "return=minimal",
        },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          status.textContent = "Done. We'll email " + body.email + " when these rates change.";
          form.querySelector(".alert-fields").hidden = true;
          track("Rate alert signup", { state: body.state, trade: body.trade, crew: body.crew_size });
        })
        .catch(function () {
          status.textContent = "That didn't save. Try again, or email support@easywh347.com.";
          button.disabled = false;
        });
    });
  });
})();
