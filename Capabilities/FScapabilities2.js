document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = btn.dataset.filter;
        document.querySelectorAll('.card').forEach(card => {
            card.style.display = (f === 'all' || card.dataset.category.includes(f)) ? '' : 'none';
        });
    });
});
