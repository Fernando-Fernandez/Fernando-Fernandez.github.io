function computeLineDiff(leftLines, rightLines) {
  const n = leftLines.length, m = rightLines.length;
  const dp = Array.from({length: n + 1}, () => Array(m + 1).fill(0));
  // Populate the DP matrix row by row to capture the LCS length ending at each pair of indices.
  for (let i = 1; i <= n; i++) {
    // Compare the current left line against every right line to update the DP cell.
    for (let j = 1; j <= m; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lcsIdx = [];
  let i = n, j = m;
  // Walk back through the DP table to record the coordinates of the LCS in reverse order.
  while (i > 0 && j > 0) {
    if (leftLines[i - 1] === rightLines[j - 1]) {
      lcsIdx.push([i - 1, j - 1]);
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) i--;
    else j--;
  }
  lcsIdx.reverse();
  const diff = [];
  let leftPos = 0, rightPos = 0;
  // Replay the LCS sequence to emit diff entries between matching segments.
  lcsIdx.forEach(([leftIdx, rightIdx]) => {
    // Emit all consecutive lines that exist only on the left before the next shared line.
    while (leftPos < leftIdx) {
      diff.push({type: 'leftOnly', left: leftPos, right: -1, line: leftLines[leftPos]});
      leftPos++;
    }
    // Emit all consecutive lines that exist only on the right before the next shared line.
    while (rightPos < rightIdx) {
      diff.push({type: 'rightOnly', right: rightPos, left: -1, line: rightLines[rightPos]});
      rightPos++;
    }
    diff.push({type: 'common', left: leftIdx, right: rightIdx, line: leftLines[leftIdx]});
    leftPos = leftIdx + 1;
    rightPos = rightIdx + 1;
  });
  // Flush any remaining trailing lines that only exist on the left.
  while (leftPos < leftLines.length) diff.push({type: 'leftOnly', left: leftPos, right: -1, line: leftLines[leftPos++]});
  // Flush any remaining trailing lines that only exist on the right.
  while (rightPos < rightLines.length) diff.push({type: 'rightOnly', right: rightPos, left: -1, line: rightLines[rightPos++]});
  return diff;
}

function renderDiff(diff) {
  const tbody = document.createElement('tbody');
  let leftIdx = 0, rightIdx = 0;
  // Render each diff item into a new table row with the appropriate styling.
  diff.forEach(item => {
    const tr = document.createElement('tr');
    const leftTd = document.createElement('td');
    const rightTd = document.createElement('td');
    const statusTd = document.createElement('td');
    if (item.type === 'common') {
      leftTd.textContent = item.line;
      rightTd.textContent = item.line;
      statusTd.textContent = '';
    } else if (item.type === 'leftOnly') {
      leftTd.textContent = item.line;
      rightTd.textContent = '';
      statusTd.textContent = '';
      leftTd.classList.add('left-only');
      rightTd.classList.add('empty');
    } else if (item.type === 'rightOnly') {
      rightTd.textContent = item.line;
      leftTd.textContent = '';
      statusTd.textContent = '';
      leftTd.classList.add('empty');
      rightTd.classList.add('right-only');
    }
    tr.appendChild(leftTd);
    tr.appendChild(rightTd);
    tr.appendChild(statusTd);
    tbody.appendChild(tr);
    leftIdx = rightIdx = item.type === 'common' ? Math.max(leftIdx, rightIdx) + 1
                                               : Math.max(leftIdx, rightIdx);
  });
  return tbody;
}

document.getElementById('compareBtn').addEventListener('click', () => {
  const left = document.getElementById('left');
  const right = document.getElementById('right');
  const result = document.getElementById('result');
  result.innerHTML = '';
  const leftLines = left.value.split(/\r?\n/);
  const rightLines = right.value.split(/\r?\n/);
  const diff = computeLineDiff(leftLines, rightLines);
  const tbody = renderDiff(diff);
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr><th>Left</th><th>Right</th><th>Status</th></tr>
    </thead>`;
  table.appendChild(tbody);
  result.appendChild(table);
});
