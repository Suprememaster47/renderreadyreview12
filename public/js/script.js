document.addEventListener("DOMContentLoaded", () => {
  const reviewsList = document.getElementById("reviewsList");
  const reviewFormWrap = document.getElementById("reviewFormWrap");
  const toggleReviewBtn = document.getElementById("toggleReviewBtn");
  const reviewForm = document.getElementById("reviewForm");
  const starsInput = document.getElementById("starsInput");
  const reviewSubmitting = document.getElementById("reviewSubmitting");
  const recaptchaContainer = document.getElementById("recaptcha-container");
  const avgStarsEl = document.getElementById("avgStarsText1");
  const totalReviewsEl = document.getElementById("totalReviews");
  const avgStarsVisual = document.querySelectorAll(".star1");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const navWrapper = document.querySelector(".reveal-section");

  let recaptchaWidgetId = null;
  let currentPage = 1;
  const limit = 5;

  // 1. reCAPTCHA Loader
  window.onRecaptchaLoad = async function () {
    try {
      const res = await fetch("/recaptcha-site-key");
      const data = await res.json();
      if (!data.site_key) return;
      if (typeof grecaptcha !== "undefined" && recaptchaContainer) {
        recaptchaWidgetId = grecaptcha.render(recaptchaContainer, { sitekey: data.site_key });
      }
    } catch (err) { console.error("Captcha error", err); }
  };

  // 2. Load Stats with Decimal Stars
  async function loadStats() {
    try {
      const res = await fetch("/api/stats");
      const stats = await res.json();
      const avg = stats.avgStars || 0;
      
      if (avgStarsEl) avgStarsEl.textContent = avg.toFixed(1);
      if (totalReviewsEl) totalReviewsEl.textContent = stats.totalReviews || 0;

      avgStarsVisual.forEach((st) => {
        const val = parseInt(st.dataset.value, 10);
        st.classList.remove("active1");
        st.style.background = "";
        st.style.webkitBackgroundClip = "";
        st.style.webkitTextFillColor = "";

        if (val <= Math.floor(avg)) {
          st.classList.add("active1");
        } else if (val === Math.ceil(avg) && avg % 1 !== 0) {
          const decimalPercent = (avg % 1) * 100;
          st.style.background = `linear-gradient(90deg, #f1c40f ${decimalPercent}%, #bbb ${decimalPercent}%)`;
          st.style.webkitBackgroundClip = "text";
          st.style.webkitTextFillColor = "transparent";
        }
      });
    } catch (err) { console.error("Stats error", err); }
  }

  // 3. Load Reviews with Directional Animation
  async function loadReviews(page = 1, animClass = 'anim-fade') {
    try {
      const res = await fetch(`/api/reviews?page=${page}&limit=${limit}`);
      const data = await res.json();
      
      if (reviewsList) {
        reviewsList.innerHTML = "";
        if (!data.reviews || data.reviews.length === 0) {
          reviewsList.innerHTML = "<p style='text-align:center;'>No reviews yet.</p>";
          return;
        }

        data.reviews.forEach((r, index) => {
          const d = document.createElement("div");
          d.className = `review-item ${animClass}`;
          d.style.animationDelay = `${index * 0.08}s`;
          const when = new Date(r.createdAt).toLocaleDateString();
          d.innerHTML = `
            <strong>${r.name || "Anonymous"}</strong> • ${r.stars}★ 
            <small style="color:#888; display:block; font-size:11px;">${when}</small>
            <div style="margin-top:8px; font-size:14px; line-height:1.4;">${r.review_text}</div>
          `;
          reviewsList.appendChild(d);
        });
      }

      if (prevBtn && nextBtn) {
        prevBtn.classList.toggle('disabled', page <= 1);
        nextBtn.classList.toggle('disabled', page >= data.total_pages);
        prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; loadReviews(currentPage, 'anim-prev'); } };
        nextBtn.onclick = () => { if (currentPage < data.total_pages) { currentPage++; loadReviews(currentPage, 'anim-next'); } };
      }
    } catch (err) { console.error("Load error", err); }
  }

  // 4. Initialization & Scroll Reveal
  if (navWrapper) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          loadReviews(currentPage, 'anim-fade');
          loadStats();
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    observer.observe(navWrapper);
  } else {
    loadReviews(currentPage, 'anim-fade');
    loadStats();
  }

  // 5. Form Interactions (Clean class toggle)
  if (toggleReviewBtn) {
    toggleReviewBtn.addEventListener("click", () => {
      const isOpen = reviewFormWrap.classList.toggle("is-open");
      toggleReviewBtn.textContent = isOpen ? "Close Form" : "Write a Review";
    });
  }

  document.querySelectorAll(".star").forEach((s) => {
    s.addEventListener("click", () => {
      const val = parseInt(s.dataset.value, 10);
      starsInput.value = val;
      document.querySelectorAll(".star").forEach((st) => 
        st.classList.toggle("active", parseInt(st.dataset.value, 10) <= val)
      );
    });
  });

  // 6. Submission
  if (reviewForm) {
    reviewForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      reviewSubmitting.classList.remove("hidden");
      let token = (typeof grecaptcha !== "undefined" && recaptchaWidgetId !== null) ? grecaptcha.getResponse(recaptchaWidgetId) : "";
      if (!token) { reviewSubmitting.classList.add("hidden"); return alert("Complete Captcha"); }

      const formData = Object.fromEntries(new FormData(reviewForm).entries());
      formData.recaptcha_token = token;

      try {
        const resp = await fetch("/api/submit_review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData)
        });
        const res = await resp.json();
        reviewSubmitting.classList.add("hidden");
        if (res.success) {
          reviewForm.reset();
          if (typeof grecaptcha !== "undefined") grecaptcha.reset(recaptchaWidgetId);
          reviewFormWrap.classList.remove("is-open");
          toggleReviewBtn.textContent = "Write a Review";
          currentPage = 1;
          loadReviews(1, 'anim-fade');
          loadStats();
        } else { alert(res.message || "Failed"); }
      } catch (err) { reviewSubmitting.classList.add("hidden"); alert("Network Error"); }
    });
  }
});