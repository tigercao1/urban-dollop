(function () {
  function applySeasonCardCount() {
    var count = document.querySelectorAll('.club-season__card').length;
    if (!count) return;
    document.querySelectorAll('[data-stat-source="season_cards"]').forEach(function (element) {
      element.textContent = count;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applySeasonCardCount);
  } else {
    applySeasonCardCount();
  }
  document.addEventListener('shopify:section:load', applySeasonCardCount);
})();
