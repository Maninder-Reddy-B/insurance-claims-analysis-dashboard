// Dataset state and paging
let filteredData = [];
let currentPage = 1;
const itemsPerPage = 15;
let activeDAXMeasure = null;

// References to chart objects so we can destroy them before redrawing
let trendsChart = null;
let productChart = null;
let rejectionChart = null;
let segmentChart = null;

// DAX Measure definitions for reference sheet
const DAX_MEASURES = [
    {
        id: "total_claims",
        name: "Total Claims",
        dax: `[Total Claims] = \n<span class="dax-function">COUNT</span>(<span class="dax-table">Claims</span>[<span class="dax-column">Claim_ID</span>])`,
        explanation: "Calculates the total count of claim records. Equivalent to counting rows in the Claims table.",
        calculate: (data) => {
            return formatNumber(data.length, 0);
        }
    },
    {
        id: "total_payout",
        name: "Total Payout",
        dax: `[Total Payout] = \n<span class="dax-function">SUM</span>(<span class="dax-table">Claims</span>[<span class="dax-column">Payout_Amount</span>])`,
        explanation: "Calculates the sum of actual payouts. Rejected claims have a payout of $0.",
        calculate: (data) => {
            const sum = data.reduce((acc, curr) => acc + curr.Payout_Amount, 0);
            return formatCurrency(sum);
        }
    },
    {
        id: "avg_payout",
        name: "Average Payout",
        dax: `[Average Payout] = \n<span class="dax-function">AVERAGE</span>(<span class="dax-table">Claims</span>[<span class="dax-column">Payout_Amount</span>])`,
        explanation: "Computes the average payout amount across all claims (includes rejected claims with $0 payout).",
        calculate: (data) => {
            if (data.length === 0) return "$0.00";
            const sum = data.reduce((acc, curr) => acc + curr.Payout_Amount, 0);
            return formatCurrency(sum / data.length);
        }
    },
    {
        id: "rejection_rate",
        name: "Claim Rejection Rate",
        dax: `[Claim Rejection Rate] = \n<span class="dax-function">DIVIDE</span>(\n    <span class="dax-function">CALCULATE</span>(\n        <span class="dax-function">COUNT</span>(<span class="dax-table">Claims</span>[<span class="dax-column">Claim_ID</span>]), \n        <span class="dax-table">Claims</span>[<span class="dax-column">Claim_Status</span>] = <span class="dax-string">"Rejected"</span>\n    ), \n    [Total Claims], \n    0\n)`,
        explanation: "Calculates the percentage of rejected claims using the DIVIDE function to safely handle blank/zero total claim counts.",
        calculate: (data) => {
            if (data.length === 0) return "0.00%";
            const rejected = data.filter(c => c.Claim_Status === "Rejected").length;
            return ((rejected / data.length) * 100).toFixed(2) + "%";
        }
    },
    {
        id: "auto_payout_ratio",
        name: "Auto Payout Ratio",
        dax: `[Auto Payout Ratio] = \n<span class="dax-function">DIVIDE</span>(\n    <span class="dax-function">CALCULATE</span>(\n        [Total Payout], \n        <span class="dax-table">Claims</span>[<span class="dax-column">Product_Type</span>] = <span class="dax-string">"Auto"</span>\n    ), \n    [Total Payout], \n    0\n)`,
        explanation: "Calculates the ratio of total payouts for Auto claims relative to overall payouts across all insurance types.",
        calculate: (data) => {
            const total = data.reduce((acc, curr) => acc + curr.Payout_Amount, 0);
            if (total === 0) return "0.00%";
            const autoPayout = data.filter(c => c.Product_Type === "Auto")
                                    .reduce((acc, curr) => acc + curr.Payout_Amount, 0);
            return ((autoPayout / total) * 100).toFixed(2) + "%";
        }
    },
    {
        id: "sme_avg_cycle",
        name: "SME Avg Processing Days",
        dax: `[SME Avg Processing Days] = \n<span class="dax-function">CALCULATE</span>(\n    <span class="dax-function">AVERAGE</span>(<span class="dax-table">Claims</span>[<span class="dax-column">Processing_Time_Days</span>]), \n    <span class="dax-table">Claims</span>[<span class="dax-column">Customer_Segment</span>] = <span class="dax-string">"SME"</span>\n)`,
        explanation: "Finds the average processing cycle duration in days for SME customer claims. Under Review claims are ignored.",
        calculate: (data) => {
            const smeClaims = data.filter(c => c.Customer_Segment === "SME" && c.Processing_Time_Days !== "");
            if (smeClaims.length === 0) return "N/A";
            const sum = smeClaims.reduce((acc, curr) => acc + Number(curr.Processing_Time_Days), 0);
            return (sum / smeClaims.length).toFixed(1) + " Days";
        }
    }
];

// Helper formatting functions
function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(val);
}

function formatNumber(val, decimals = 0) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(val);
}

// Initial page setup
document.addEventListener("DOMContentLoaded", () => {
    setupFilters();
    renderDAXSelector();
    applyFilters();
});

// Bind change listeners to input elements
function setupFilters() {
    document.getElementById("filter-start-date").addEventListener("change", applyFilters);
    document.getElementById("filter-end-date").addEventListener("change", applyFilters);
    
    document.getElementById("table-search").addEventListener("input", () => {
        currentPage = 1;
        renderTable(filteredData);
    });
    
    // Bind all lists checklists
    const checkboxSelectors = [
        "#filter-products input",
        "#filter-regions input",
        "#filter-segments input"
    ];
    
    checkboxSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(cb => {
            cb.addEventListener("change", applyFilters);
        });
    });
    
    // Reset filters button logic
    document.getElementById("reset-filters").addEventListener("click", () => {
        document.getElementById("filter-start-date").value = "2024-01-01";
        document.getElementById("filter-end-date").value = "2025-12-31";
        
        document.querySelectorAll(".checkbox-list input").forEach(cb => {
            cb.checked = true;
        });
        
        applyFilters();
    });
}

// Filter dataset dynamically based on selected checkboxes and dates
function applyFilters() {
    const startStr = document.getElementById("filter-start-date").value;
    const endStr = document.getElementById("filter-end-date").value;
    
    const getSelected = (selector) => {
        return Array.from(document.querySelectorAll(selector))
            .filter(cb => cb.checked)
            .map(cb => cb.value);
    };
    
    const products = getSelected("#filter-products input");
    const regions = getSelected("#filter-regions input");
    const segments = getSelected("#filter-segments input");
    
    filteredData = CLAIMS_DATA.filter(row => {
        if (row.Claim_Date < startStr || row.Claim_Date > endStr) return false;
        if (!products.includes(row.Product_Type)) return false;
        if (!regions.includes(row.Region)) return false;
        if (!segments.includes(row.Customer_Segment)) return false;
        return true;
    });
    
    currentPage = 1;
    
    // Refresh calculations and charts
    updateKPIs(filteredData);
    updateCharts(filteredData);
    renderTable(filteredData);
    
    if (activeDAXMeasure) {
        evaluateDAX(activeDAXMeasure);
    }
}

// Calculate top card metrics
function updateKPIs(data) {
    const totalClaims = data.length;
    let totalClaimedVal = 0;
    let totalPayoutVal = 0;
    let approved = 0;
    let timeClaimsCount = 0;
    let totalDays = 0;
    
    data.forEach(row => {
        totalClaimedVal += row.Claim_Amount;
        totalPayoutVal += row.Payout_Amount;
        if (row.Claim_Status === "Approved") {
            approved++;
        }
        if (row.Processing_Time_Days !== "") {
            timeClaimsCount++;
            totalDays += Number(row.Processing_Time_Days);
        }
    });
    
    const approvalRate = totalClaims > 0 ? (approved / totalClaims) * 100 : 0;
    const avgCycle = timeClaimsCount > 0 ? totalDays / timeClaimsCount : 0;
    
    document.getElementById("kpi-total-claims").innerText = formatNumber(totalClaims, 0);
    document.getElementById("kpi-claimed-amt").innerText = formatCurrency(totalClaimedVal);
    document.getElementById("kpi-payout-amt").innerText = formatCurrency(totalPayoutVal);
    document.getElementById("kpi-approval-rate").innerText = approvalRate.toFixed(1) + "%";
    document.getElementById("kpi-processing-time").innerText = avgCycle > 0 ? avgCycle.toFixed(1) + " Days" : "N/A";
}

// Render visual elements using Chart.js
function updateCharts(data) {
    const fontConfig = { family: 'Segoe UI', size: 11, color: '#605e5c' };
    const gridColor = '#e5e7eb';
    
    // ----------------------------------------------------
    // Chart 1: Claims volume & Approval Trends Over Time
    // ----------------------------------------------------
    const monthlyData = {};
    data.forEach(r => {
        const mKey = r.Claim_Date.substring(0, 7);
        if (!monthlyData[mKey]) monthlyData[mKey] = { count: 0, approved: 0 };
        monthlyData[mKey].count++;
        if (r.Claim_Status === "Approved") monthlyData[mKey].approved++;
    });
    
    const sortedMonths = Object.keys(monthlyData).sort();
    const counts = sortedMonths.map(m => monthlyData[m].count);
    const rates = sortedMonths.map(m => 
        monthlyData[m].count > 0 ? (monthlyData[m].approved / monthlyData[m].count) * 100 : 0
    );
    
    if (trendsChart) trendsChart.destroy();
    trendsChart = new Chart(document.getElementById("chart-trends").getContext("2d"), {
        type: 'line',
        data: {
            labels: sortedMonths.map(m => {
                const date = new Date(m + "-02");
                return date.toLocaleString('default', { month: 'short', year: '2-digit' });
            }),
            datasets: [
                {
                    label: 'Claim Volume',
                    data: counts,
                    type: 'bar',
                    backgroundColor: 'rgba(17, 141, 255, 0.65)',
                    borderColor: '#118dff',
                    borderWidth: 1,
                    yAxisID: 'yVolume'
                },
                {
                    label: 'Approval Rate (%)',
                    data: rates,
                    type: 'line',
                    borderColor: '#12239e',
                    borderWidth: 2,
                    pointBackgroundColor: '#12239e',
                    fill: false,
                    tension: 0.15,
                    yAxisID: 'yRate'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#605e5c', font: { family: 'Segoe UI' } } }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#605e5c', font: { family: 'Segoe UI', size: 10 } }
                },
                yVolume: {
                    type: 'linear',
                    position: 'left',
                    grid: { color: gridColor },
                    ticks: { color: '#605e5c' },
                    title: { display: true, text: 'Claims Count', color: '#605e5c' }
                },
                yRate: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#12239e', callback: val => val + '%' },
                    suggestedMin: 0,
                    suggestedMax: 100,
                    title: { display: true, text: 'Approval Rate %', color: '#12239e' }
                }
            }
        }
    });

    // ----------------------------------------------------
    // Chart 2: Payout vs Claimed by Product Type
    // ----------------------------------------------------
    const productTypes = ["Auto", "Health", "Home", "Life", "Travel"];
    const productTotals = {};
    productTypes.forEach(p => productTotals[p] = { claimed: 0, paid: 0 });
    
    data.forEach(r => {
        if (productTotals[r.Product_Type]) {
            productTotals[r.Product_Type].claimed += r.Claim_Amount;
            productTotals[r.Product_Type].paid += r.Payout_Amount;
        }
    });
    
    if (productChart) productChart.destroy();
    productChart = new Chart(document.getElementById("chart-product-comparison").getContext("2d"), {
        type: 'bar',
        data: {
            labels: productTypes,
            datasets: [
                {
                    label: 'Gross Claimed',
                    data: productTypes.map(p => productTotals[p].claimed),
                    backgroundColor: '#12239e',
                    borderRadius: 2
                },
                {
                    label: 'Paid Payout',
                    data: productTypes.map(p => productTotals[p].paid),
                    backgroundColor: '#118dff',
                    borderRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#605e5c', font: { family: 'Segoe UI' } } }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#605e5c', font: { family: 'Segoe UI' } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { 
                        color: '#605e5c',
                        callback: val => '$' + formatNumber(val / 1000, 0) + 'k'
                    }
                }
            }
        }
    });

    // ----------------------------------------------------
    // Chart 3: Rejections Reason Distribution
    // ----------------------------------------------------
    const reasonGroups = {};
    data.forEach(r => {
        if (r.Claim_Status === "Rejected" && r.Rejection_Reason) {
            reasonGroups[r.Rejection_Reason] = (reasonGroups[r.Rejection_Reason] || 0) + 1;
        }
    });
    
    const labels = Object.keys(reasonGroups);
    const volumes = Object.values(reasonGroups);
    
    if (rejectionChart) rejectionChart.destroy();
    rejectionChart = new Chart(document.getElementById("chart-rejections").getContext("2d"), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: volumes,
                backgroundColor: [
                    '#118DFF', // Power BI Blue
                    '#12239E', // Navy
                    '#E35B00', // Orange
                    '#F2C811', // Yellow
                    '#7F3C8D'  // Purple
                ],
                borderWidth: 1,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'bottom',
                    labels: { 
                        color: '#605e5c', 
                        font: { family: 'Segoe UI', size: 10 },
                        padding: 8
                    } 
                }
            }
        }
    });

    // ----------------------------------------------------
    // Chart 4: Segment Performance
    // ----------------------------------------------------
    const segments = ["Individual", "Corporate", "SME"];
    const segmentTotals = {};
    segments.forEach(s => segmentTotals[s] = { count: 0, payouts: 0 });
    
    data.forEach(r => {
        if (segmentTotals[r.Customer_Segment]) {
            segmentTotals[r.Customer_Segment].count++;
            segmentTotals[r.Customer_Segment].payouts += r.Payout_Amount;
        }
    });
    
    if (segmentChart) segmentChart.destroy();
    segmentChart = new Chart(document.getElementById("chart-segments").getContext("2d"), {
        type: 'bar',
        data: {
            labels: segments,
            datasets: [
                {
                    label: 'Claims Count',
                    data: segments.map(s => segmentTotals[s].count),
                    backgroundColor: 'rgba(17, 141, 255, 0.7)',
                    borderColor: '#118dff',
                    borderWidth: 1,
                    yAxisID: 'yCount',
                    borderRadius: 2
                },
                {
                    label: 'Avg Payout ($)',
                    data: segments.map(s => 
                        segmentTotals[s].count > 0 ? segmentTotals[s].payouts / segmentTotals[s].count : 0
                    ),
                    type: 'line',
                    borderColor: '#e36209',
                    pointBackgroundColor: '#e36209',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.1,
                    yAxisID: 'yAvg'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#605e5c', font: { family: 'Segoe UI' } } }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#605e5c', font: { family: 'Segoe UI' } }
                },
                yCount: {
                    type: 'linear',
                    position: 'left',
                    grid: { color: gridColor },
                    ticks: { color: '#605e5c' },
                    title: { display: true, text: 'Claims Count', color: '#605e5c' }
                },
                yAvg: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#e36209', callback: val => '$' + formatNumber(val, 0) },
                    title: { display: true, text: 'Avg Payout ($)', color: '#e36209' }
                }
            }
        }
    });
}

// Paginate and search table dataset
function renderTable(data) {
    const searchStr = document.getElementById("table-search").value.toLowerCase().trim();
    
    const matches = data.filter(row => {
        if (!searchStr) return true;
        return row.Claim_ID.toLowerCase().includes(searchStr) ||
               row.Customer_ID.toLowerCase().includes(searchStr) ||
               row.Region.toLowerCase().includes(searchStr) ||
               row.Product_Type.toLowerCase().includes(searchStr);
    });
    
    const count = matches.length;
    const startIdx = (currentPage - 1) * itemsPerPage;
    const endIdx = Math.min(startIdx + itemsPerPage, count);
    
    const pageData = matches.slice(startIdx, endIdx);
    const tbody = document.getElementById("table-body");
    tbody.innerHTML = "";
    
    if (pageData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No records found.</td></tr>`;
        document.getElementById("table-showing-start").innerText = 0;
        document.getElementById("table-showing-end").innerText = 0;
        document.getElementById("table-showing-total").innerText = 0;
        renderPagination(0);
        return;
    }
    
    pageData.forEach(r => {
        const tr = document.createElement("tr");
        
        let statusBadge = "status-pending";
        if (r.Claim_Status === "Approved") statusBadge = "status-approved";
        else if (r.Claim_Status === "Rejected") statusBadge = "status-rejected";
        
        tr.innerHTML = `
            <td style="font-weight: 600;">${r.Claim_ID}</td>
            <td>${r.Claim_Date}</td>
            <td>${r.Customer_ID}</td>
            <td>${r.Customer_Segment}</td>
            <td>${r.Customer_Age}</td>
            <td>${r.Customer_Gender}</td>
            <td>${r.Region}</td>
            <td>${r.Product_Type}</td>
            <td class="text-right">${formatCurrency(r.Claim_Amount)}</td>
            <td><span class="status-pill ${statusBadge}">${r.Claim_Status}</span></td>
            <td class="text-right" style="font-weight: 600; color: ${r.Payout_Amount > 0 ? '#107c41' : 'inherit'}">${formatCurrency(r.Payout_Amount)}</td>
            <td style="font-size: 0.725rem; max-width: 140px; overflow: hidden; text-overflow: ellipsis;">${r.Rejection_Reason || "-"}</td>
            <td>${r.Processing_Time_Days || "-"}</td>
        `;
        tbody.appendChild(tr);
    });
    
    document.getElementById("table-showing-start").innerText = startIdx + 1;
    document.getElementById("table-showing-end").innerText = endIdx;
    document.getElementById("table-showing-total").innerText = count;
    
    renderPagination(count);
}

// Generate pagination controls
function renderPagination(totalCount) {
    const pages = Math.ceil(totalCount / itemsPerPage);
    const container = document.getElementById("table-pagination");
    container.innerHTML = "";
    
    if (pages <= 1) return;
    
    const prev = document.createElement("span");
    prev.className = `page-link ${currentPage === 1 ? 'disabled' : ''}`;
    prev.innerHTML = `<i class="fa-solid fa-chevron-left"></i>`;
    if (currentPage > 1) {
        prev.addEventListener("click", () => {
            currentPage--;
            renderTable(filteredData);
        });
    }
    container.appendChild(prev);
    
    let start = Math.max(1, currentPage - 2);
    let end = Math.min(pages, start + 4);
    if (end - start < 4) {
        start = Math.max(1, end - 4);
    }
    
    for (let i = start; i <= end; i++) {
        const link = document.createElement("span");
        link.className = `page-link ${currentPage === i ? 'active' : ''}`;
        link.innerText = i;
        link.addEventListener("click", () => {
            currentPage = i;
            renderTable(filteredData);
        });
        container.appendChild(link);
    }
    
    const next = document.createElement("span");
    next.className = `page-link ${currentPage === pages ? 'disabled' : ''}`;
    next.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;
    if (currentPage < pages) {
        next.addEventListener("click", () => {
            currentPage++;
            renderTable(filteredData);
        });
    }
    container.appendChild(next);
}

// Render list of DAX measures
function renderDAXSelector() {
    const list = document.getElementById("dax-measures-list");
    list.innerHTML = "";
    
    DAX_MEASURES.forEach((m, idx) => {
        const btn = document.createElement("button");
        btn.className = "measure-btn";
        btn.innerHTML = `${m.name} <i class="fa-solid fa-chevron-right"></i>`;
        
        btn.addEventListener("click", () => {
            document.querySelectorAll(".measure-btn").forEach(el => el.classList.remove("active"));
            btn.classList.add("active");
            activeDAXMeasure = m;
            evaluateDAX(m);
        });
        
        list.appendChild(btn);
        
        if (idx === 0) {
            btn.classList.add("active");
            activeDAXMeasure = m;
        }
    });
    
    if (activeDAXMeasure) {
        evaluateDAX(activeDAXMeasure);
    }
}

// Recalculate DAX formula results based on active dataset filters
function evaluateDAX(measure) {
    document.getElementById("dax-code-display").innerHTML = measure.dax;
    document.getElementById("dax-explanation-display").innerText = measure.explanation;
    
    const result = measure.calculate(filteredData);
    document.getElementById("dax-result-display").innerText = result;
}
