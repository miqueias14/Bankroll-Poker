(function () {
  "use strict";

  var STORAGE_KEY = "poker-bankroll-control-v1";

  var DEFAULT_STATE = {
    transactions: [],
    sessions: [],
    settings: {
      dailyStopLoss: 0,
      dailyStopWin: 0,
      maxSessionsPerDay: 0,
      maxLostBuyinsPerDay: 0
    },
    goals: [],
    reviews: {}
  };

  var state = loadState();

  document.addEventListener("DOMContentLoaded", function () {
    setDefaultDates();
    bindEvents();
    registerServiceWorker();
    renderAll();
  });

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function loadState() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return cloneDefaults();
    }

    try {
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("Backup local inválido, iniciando estado limpo.", error);
      return cloneDefaults();
    }
  }

  function normalizeState(input) {
    var source = input && input.data ? input.data : input;
    var base = cloneDefaults();

    return {
      transactions: Array.isArray(source && source.transactions)
        ? source.transactions.map(normalizeTransaction).filter(Boolean)
        : base.transactions,
      sessions: Array.isArray(source && source.sessions)
        ? source.sessions.map(normalizeSession).filter(Boolean)
        : base.sessions,
      settings: Object.assign({}, base.settings, source && source.settings ? source.settings : {}),
      goals: Array.isArray(source && source.goals)
        ? source.goals.map(normalizeGoal).filter(Boolean)
        : base.goals,
      reviews: source && source.reviews && typeof source.reviews === "object" ? source.reviews : base.reviews
    };
  }

  function normalizeTransaction(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    return {
      id: item.id || uid("tx"),
      date: item.date || todayString(),
      kind: ["initial", "deposit", "withdrawal"].indexOf(item.kind) >= 0 ? item.kind : "deposit",
      channel: item.channel === "live" ? "live" : "online",
      amount: positiveNumber(item.amount),
      note: item.note || ""
    };
  }

  function normalizeSession(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    var buyIn = positiveNumber(item.buyIn);
    var entries = Math.max(1, Math.round(positiveNumber(item.entries) || 1));
    var invested = positiveNumber(item.invested || buyIn * entries);
    var payout = positiveNumber(item.payout);

    return {
      id: item.id || uid("session"),
      date: item.date || todayString(),
      channel: item.channel === "live" ? "live" : "online",
      modality: normalizeModality(item.modality),
      venue: item.venue || "",
      buyIn: buyIn,
      entries: entries,
      invested: invested,
      payout: payout,
      netResult: numberOrZero(item.netResult !== undefined ? item.netResult : payout - invested),
      hours: positiveNumber(item.hours),
      notes: item.notes || "",
      tilt: Boolean(item.tilt),
      stopRespected: item.stopRespected !== false,
      errors: item.errors || "",
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || null
    };
  }

  function normalizeGoal(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    return {
      id: item.id || uid("goal"),
      name: item.name || "Meta",
      target: positiveNumber(item.target),
      current: positiveNumber(item.current),
      deadline: item.deadline || todayString(),
      status: ["andamento", "concluida", "atrasada"].indexOf(item.status) >= 0 ? item.status : "andamento",
      createdAt: item.createdAt || new Date().toISOString()
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    flashStorageStatus();
  }

  function bindEvents() {
    byId("quickDepositBtn").addEventListener("click", openDepositForm);
    byId("closeBankrollPanel").addEventListener("click", hideBankrollSection);
    byId("banca").addEventListener("click", function (event) {
      if (event.target === byId("banca")) {
        hideBankrollSection();
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !byId("banca").classList.contains("hidden-section")) {
        hideBankrollSection();
      }
    });
    byId("transactionForm").addEventListener("submit", handleTransactionSubmit);
    byId("cancelTransactionEdit").addEventListener("click", function () {
      resetTransactionForm();
      hideBankrollSection();
    });
    byId("transactionsTableBody").addEventListener("click", handleTransactionAction);

    byId("sessionForm").addEventListener("submit", handleSessionSubmit);
    byId("cancelSessionEdit").addEventListener("click", resetSessionForm);
    byId("sessionsTableBody").addEventListener("click", handleSessionAction);
    ["sessionBuyIn", "sessionEntries", "sessionPayout"].forEach(function (id) {
      byId(id).addEventListener("input", updateSessionCalculatedFields);
    });

    byId("settingsForm").addEventListener("submit", handleSettingsSubmit);

    ["limitCheckChannel", "limitCheckModality", "limitCheckBuyIn"].forEach(function (id) {
      byId(id).addEventListener("input", renderLimitCheck);
      byId(id).addEventListener("change", renderLimitCheck);
    });

    byId("reportFilters").addEventListener("input", renderReports);
    byId("reportFilters").addEventListener("change", renderReports);
    byId("clearReportFilters").addEventListener("click", clearReportFilters);

    byId("reviewNegativeOnly").addEventListener("change", renderReview);
    byId("revisao").addEventListener("click", handleReviewAction);

    byId("goalForm").addEventListener("submit", handleGoalSubmit);
    byId("cancelGoalEdit").addEventListener("click", resetGoalForm);
    byId("goalsList").addEventListener("click", handleGoalAction);

    byId("exportJsonBtn").addEventListener("click", exportJson);
    byId("importJsonBtn").addEventListener("click", function () {
      byId("importJsonInput").click();
    });
    byId("importJsonInput").addEventListener("change", importJson);
    byId("exportCsvBtn").addEventListener("click", exportSessionsCsv);
    byId("clearDataBtn").addEventListener("click", clearAllData);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (window.location.protocol === "file:") {
      return;
    }

    navigator.serviceWorker.register("sw.js").catch(function (error) {
      console.warn("Nao foi possivel ativar o modo app/offline.", error);
    });
  }

  function setDefaultDates() {
    byId("transactionDate").value = todayString();
    byId("sessionDate").value = todayString();
    byId("goalDeadline").value = todayString();
    updateSessionCalculatedFields();
  }

  function renderAll() {
    renderDashboard();
    renderTransactions();
    renderSessions();
    renderLimits();
    renderStopSettings();
    renderStopAlerts();
    renderReports();
    renderReview();
    renderGoals();
    renderLimitCheck();
  }

  function renderDashboard() {
    var totalBankroll = getTotalBankroll();
    var onlineBankroll = getBankrollByChannel("online");
    var liveBankroll = getBankrollByChannel("live");
    var totalProfit = getTotalSessionProfit(state.sessions);
    var totalInvested = getTotalInvested(state.sessions);
    var totalHours = getTotalHours(state.sessions);
    var roi = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    var abi = getAbi();
    var cashWinrate = getCashWinrate();
    var swings = calculateSwings();

    setText("kpiTotalBankroll", money(totalBankroll));
    setText("kpiOnlineBankroll", money(onlineBankroll));
    setText("kpiLiveBankroll", money(liveBankroll));
    setText("kpiTotalProfit", money(totalProfit));
    setTone("kpiTotalProfit", totalProfit);
    setText("kpiSessions", String(state.sessions.length));
    setText("kpiRoi", percent(roi));
    setTone("kpiRoi", roi);
    setText("kpiAbi", money(abi));
    setText("kpiCashWinrate", money(cashWinrate) + "/h");
    setTone("kpiCashWinrate", cashWinrate);
    setText("kpiHourlyProfit", money(totalHours > 0 ? totalProfit / totalHours : 0) + "/h");
    setTone("kpiHourlyProfit", totalHours > 0 ? totalProfit / totalHours : 0);
    setText("kpiUpswing", money(swings.upswing));
    setText("kpiDownswing", money(swings.downswing));
    byId("kpiDownswing").className = swings.downswing > 0 ? "negative" : "";

    renderRiskAlerts();
    renderChart();
  }

  function renderRiskAlerts() {
    var container = byId("riskAlerts");
    var riskySessions = getRiskySessions();
    var stopMessages = getStopMessages();
    var html = "";

    if (getTotalBankroll() <= 0 && (state.transactions.length || state.sessions.length)) {
      html += alertHtml("danger", "Banca zerada ou negativa", "Revise limites, saques e resultados antes de registrar novos jogos.");
    }

    if (riskySessions.length > 0) {
      html += alertHtml("warning", "Risco de jogar acima da banca", "Há " + riskySessions.length + " sessão(ões) com buy-in acima da recomendação atual.");
    }

    if (stopMessages.length > 0) {
      html += alertHtml("warning", "Limites diários atingidos", stopMessages.join(" "));
    }

    if (!html) {
      html = alertHtml("success", "Banca sob controle", "Nenhum alerta crítico no momento.");
    }

    container.innerHTML = html;
  }

  function renderChart() {
    var container = byId("bankrollChart");
    var events = getBankrollEvents();
    setText("chartSummary", events.length ? events.length + " lançamento(s)" : "Sem lançamentos");

    if (!events.length) {
      container.innerHTML = '<div class="empty-state">Registre banca ou sessões para ver a curva.</div>';
      return;
    }

    var width = 820;
    var height = 282;
    var padding = 34;
    var cumulative = 0;
    var points = events.map(function (event, index) {
      cumulative += event.amount;
      return {
        xIndex: index,
        yValue: cumulative,
        date: event.date
      };
    });

    var values = points.map(function (point) { return point.yValue; }).concat([0]);
    var minValue = Math.min.apply(null, values);
    var maxValue = Math.max.apply(null, values);

    if (minValue === maxValue) {
      minValue -= 1;
      maxValue += 1;
    }

    var xMax = Math.max(points.length - 1, 1);
    var range = maxValue - minValue;
    var coords = points.map(function (point) {
      return {
        x: padding + (point.xIndex / xMax) * (width - padding * 2),
        y: height - padding - ((point.yValue - minValue) / range) * (height - padding * 2),
        value: point.yValue,
        date: point.date
      };
    });

    var path = coords.map(function (point, index) {
      return (index === 0 ? "M" : "L") + point.x.toFixed(2) + " " + point.y.toFixed(2);
    }).join(" ");
    var areaPath = path + " L " + coords[coords.length - 1].x.toFixed(2) + " " + (height - padding) + " L " + coords[0].x.toFixed(2) + " " + (height - padding) + " Z";
    var last = coords[coords.length - 1];
    var lineColor = last.value >= 0 ? "#35d07f" : "#ff5f72";
    var zeroY = height - padding - ((0 - minValue) / range) * (height - padding * 2);

    container.innerHTML =
      '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Evolução da banca">' +
        '<line x1="' + padding + '" y1="' + zeroY.toFixed(2) + '" x2="' + (width - padding) + '" y2="' + zeroY.toFixed(2) + '" stroke="#303643" stroke-width="1" />' +
        '<line x1="' + padding + '" y1="' + padding + '" x2="' + padding + '" y2="' + (height - padding) + '" stroke="#303643" stroke-width="1" />' +
        '<line x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '" stroke="#303643" stroke-width="1" />' +
        '<path d="' + areaPath + '" fill="' + lineColor + '" opacity="0.12" />' +
        '<path d="' + path + '" fill="none" stroke="' + lineColor + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />' +
        '<circle cx="' + last.x.toFixed(2) + '" cy="' + last.y.toFixed(2) + '" r="6" fill="' + lineColor + '" />' +
        '<text x="' + padding + '" y="22" fill="#a6afbd" font-size="13">' + escapeSvg(money(maxValue)) + '</text>' +
        '<text x="' + padding + '" y="' + (height - 10) + '" fill="#a6afbd" font-size="13">' + escapeSvg(money(minValue)) + '</text>' +
        '<text x="' + (width - padding) + '" y="22" text-anchor="end" fill="#f2f5f8" font-size="14">' + escapeSvg(money(last.value)) + '</text>' +
      '</svg>';
  }

  function renderTransactions() {
    var body = byId("transactionsTableBody");
    var sorted = state.transactions.slice().sort(sortByDateDesc);
    setText("transactionCount", sorted.length + " lançamento(s)");

    if (!sorted.length) {
      body.innerHTML = emptyRow(6, "Nenhum lançamento de banca.");
      return;
    }

    body.innerHTML = sorted.map(function (tx) {
      var amount = getTransactionAmount(tx);
      return "<tr>" +
        "<td>" + escapeHtml(formatDate(tx.date)) + "</td>" +
        "<td>" + escapeHtml(transactionKindLabel(tx.kind)) + "</td>" +
        "<td>" + escapeHtml(channelLabel(tx.channel)) + "</td>" +
        '<td class="' + (amount >= 0 ? "positive" : "negative") + '">' + escapeHtml(money(amount)) + "</td>" +
        "<td>" + escapeHtml(tx.note || "-") + "</td>" +
        '<td><div class="cell-actions">' +
          actionButton("edit-transaction", tx.id, "Editar") +
          actionButton("delete-transaction", tx.id, "Excluir", "danger") +
        "</div></td>" +
      "</tr>";
    }).join("");
  }

  function renderSessions() {
    var body = byId("sessionsTableBody");
    var sorted = state.sessions.slice().sort(sortByDateDesc);
    setText("sessionCount", sorted.length + " sessão(ões)");

    if (!sorted.length) {
      body.innerHTML = emptyRow(10, "Nenhuma sessão registrada.");
      return;
    }

    body.innerHTML = sorted.map(function (session) {
      var net = getSessionNet(session);
      var risk = getSessionRisk(session);
      var discipline = [
        session.tilt ? '<span class="badge warning">Tilt</span>' : '<span class="badge">Sem tilt</span>',
        session.stopRespected ? '<span class="badge positive">Stop ok</span>' : '<span class="badge negative">Stop não</span>',
        risk.isRisky ? '<span class="badge warning">Agressivo</span>' : ""
      ].filter(Boolean).join(" ");

      return "<tr>" +
        "<td>" + escapeHtml(formatDate(session.date)) + "</td>" +
        "<td>" + escapeHtml(channelLabel(session.channel)) + "</td>" +
        "<td>" + escapeHtml(modalityLabel(session.modality)) + "</td>" +
        "<td>" + escapeHtml(session.venue || "-") + "</td>" +
        "<td>" + escapeHtml(money(session.buyIn)) + "</td>" +
        "<td>" + escapeHtml(money(getSessionInvested(session))) + "</td>" +
        '<td class="' + (net >= 0 ? "positive" : "negative") + '">' + escapeHtml(money(net)) + "</td>" +
        "<td>" + escapeHtml(formatNumber(session.hours)) + "h</td>" +
        "<td>" + discipline + "</td>" +
        '<td><div class="cell-actions">' +
          actionButton("edit-session", session.id, "Editar") +
          actionButton("delete-session", session.id, "Excluir", "danger") +
        "</div></td>" +
      "</tr>";
    }).join("");
  }

  function renderLimits() {
    var recommendations = [
      { title: "Torneios online", channel: "online", modality: "torneio", buyins: 100 },
      { title: "Torneios ao vivo", channel: "live", modality: "torneio", buyins: 50 },
      { title: "Cash game online", channel: "online", modality: "cash", buyins: 40 },
      { title: "Cash game ao vivo", channel: "live", modality: "cash", buyins: 30 },
      { title: "Spins e turbos", channel: "online", modality: "spin", buyins: 150, extraLive: true }
    ];

    byId("limitRecommendations").innerHTML = recommendations.map(function (item) {
      var maxOnline = getBankrollByChannel(item.channel) / item.buyins;
      var extra = "";

      if (item.extraLive) {
        extra = "<small>Ao vivo: " + escapeHtml(money(getBankrollByChannel("live") / item.buyins)) + "</small>";
      }

      return '<article class="limit-card">' +
        "<h3>" + escapeHtml(item.title) + "</h3>" +
        "<span>Mínimo: " + item.buyins + " buy-ins</span>" +
        "<strong>" + escapeHtml(money(maxOnline)) + "</strong>" +
        "<small>Buy-in máximo seguro</small>" +
        extra +
      "</article>";
    }).join("");

    var risky = getRiskySessions();
    setText("riskSessionCount", risky.length + " alerta(s)");

    byId("riskSessionList").innerHTML = risky.length
      ? risky.slice(0, 8).map(function (session) {
          var risk = getSessionRisk(session);
          return '<div class="mini-row">' +
            '<span>' + escapeHtml(formatDate(session.date) + " · " + modalityLabel(session.modality) + " · " + session.venue) + '</span>' +
            '<strong class="warning">' + escapeHtml(money(session.buyIn)) + " / máx. " + escapeHtml(money(risk.maxBuyIn)) + '</strong>' +
          '</div>';
        }).join("")
      : '<div class="empty-state">Nenhum buy-in agressivo pela banca atual.</div>';
  }

  function renderLimitCheck() {
    var channel = byId("limitCheckChannel").value;
    var modality = byId("limitCheckModality").value;
    var buyIn = readNumber("limitCheckBuyIn");
    var required = getRequiredBuyins(modality, channel);
    var maxBuyIn = getMaxBuyIn(channel, modality);
    var container = byId("limitCheckResult");

    if (!buyIn) {
      container.innerHTML = '<div class="alert warning"><strong>Buy-in máximo</strong>' + money(maxBuyIn) + " com " + required + " buy-ins de reserva.</div>";
      return;
    }

    if (buyIn <= maxBuyIn) {
      container.innerHTML = alertHtml("success", "Dentro do limite", "Esse buy-in respeita a regra de " + required + " buy-ins.");
    } else {
      container.innerHTML = alertHtml("danger", "Risco alto", "O buy-in indicado passa do máximo seguro de " + money(maxBuyIn) + ". Mensagem de risco: preserve sua banca para não quebrar.");
    }
  }

  function renderStopSettings() {
    byId("dailyStopLoss").value = state.settings.dailyStopLoss || "";
    byId("dailyStopWin").value = state.settings.dailyStopWin || "";
    byId("maxSessionsPerDay").value = state.settings.maxSessionsPerDay || "";
    byId("maxLostBuyinsPerDay").value = state.settings.maxLostBuyinsPerDay || "";
  }

  function renderStopAlerts() {
    var container = byId("stopAlerts");
    var todaySessions = getTodaySessions();
    var todayProfit = getTotalSessionProfit(todaySessions);
    var lostBuyins = getLostBuyins(todaySessions);
    var messages = getStopMessages();
    var statusRows = [
      "Resultado hoje: " + money(todayProfit),
      "Sessões hoje: " + todaySessions.length,
      "Buy-ins perdidos hoje: " + formatNumber(lostBuyins)
    ];

    var html = alertHtml(messages.length ? "warning" : "success", messages.length ? "Atenção" : "Dentro dos limites", statusRows.join(" · "));
    if (messages.length) {
      html += messages.map(function (message) {
        return alertHtml("danger", "Limite atingido", message);
      }).join("");
    }

    container.innerHTML = html;
  }

  function renderReports() {
    var sessions = getFilteredSessions();
    var totalProfit = getTotalSessionProfit(sessions);
    var totalHours = getTotalHours(sessions);
    var totalInvested = getTotalInvested(sessions);
    var positives = sessions.filter(function (session) { return getSessionNet(session) > 0; }).length;
    var negatives = sessions.filter(function (session) { return getSessionNet(session) < 0; }).length;
    var tiltCount = sessions.filter(function (session) { return session.tilt; }).length;
    var avgProfit = sessions.length ? totalProfit / sessions.length : 0;
    var avgHours = sessions.length ? totalHours / sessions.length : 0;
    var hourly = totalHours > 0 ? totalProfit / totalHours : 0;

    byId("reportSummary").innerHTML = [
      metricRow("Sessões filtradas", sessions.length),
      metricRow("Média de lucro por sessão", money(avgProfit), avgProfit),
      metricRow("Média de horas jogadas", formatNumber(avgHours) + "h"),
      metricRow("Lucro por hora", money(hourly) + "/h", hourly),
      metricRow("Total investido em buy-ins", money(totalInvested)),
      metricRow("Sessões positivas", positives),
      metricRow("Sessões negativas", negatives),
      metricRow("Sessões com tilt", sessions.length ? percent((tiltCount / sessions.length) * 100) : "0,00%")
    ].join("");

    renderGroupProfit("profitByModality", groupProfit(sessions, function (session) {
      return modalityLabel(session.modality);
    }));

    renderGroupProfit("profitByVenue", groupProfit(sessions, function (session) {
      return session.venue || "Sem local";
    }));
  }

  function renderReview() {
    var negativeOnly = byId("reviewNegativeOnly").checked;
    var sessions = state.sessions.filter(function (session) {
      return !negativeOnly || getSessionNet(session) < 0;
    }).sort(sortByDateDesc);

    var tiltSessions = sessions.filter(function (session) { return session.tilt; });
    var errorSessions = sessions.filter(function (session) { return session.errors.trim(); });

    byId("repeatedErrors").innerHTML = renderRepeatedErrors(errorSessions);
    byId("tiltSessionsList").innerHTML = tiltSessions.length
      ? tiltSessions.map(reviewCardHtml).join("")
      : '<div class="empty-state">Nenhuma sessão com tilt nesse filtro.</div>';
    byId("errorSessionsList").innerHTML = errorSessions.length
      ? errorSessions.map(reviewCardHtml).join("")
      : '<div class="empty-state">Nenhuma sessão com erro anotado nesse filtro.</div>';
  }

  function renderGoals() {
    var container = byId("goalsList");
    var sorted = state.goals.slice().sort(function (a, b) {
      return (a.deadline || "").localeCompare(b.deadline || "");
    });

    setText("goalCount", sorted.length + " meta(s)");

    if (!sorted.length) {
      container.innerHTML = '<div class="empty-state">Nenhuma meta criada.</div>';
      return;
    }

    container.innerHTML = sorted.map(function (goal) {
      var progress = getGoalProgress(goal);
      var status = resolveGoalStatus(goal);
      return '<article class="goal-card">' +
        '<header>' +
          '<div><h4>' + escapeHtml(goal.name) + '</h4><p>Prazo: ' + escapeHtml(formatDate(goal.deadline)) + '</p></div>' +
          '<span class="badge ' + goalStatusClass(status) + '">' + escapeHtml(goalStatusLabel(status)) + '</span>' +
        '</header>' +
        '<div class="progress"><span style="width:' + progress + '%"></span></div>' +
        '<div class="goal-meta">' +
          '<div><span>Atual</span><strong>' + escapeHtml(money(goal.current)) + '</strong></div>' +
          '<div><span>Alvo</span><strong>' + escapeHtml(money(goal.target)) + '</strong></div>' +
        '</div>' +
        '<div class="cell-actions">' +
          actionButton("edit-goal", goal.id, "Editar") +
          actionButton("delete-goal", goal.id, "Excluir", "danger") +
        '</div>' +
      '</article>';
    }).join("");
  }

  function handleTransactionSubmit(event) {
    event.preventDefault();

    var id = byId("transactionId").value;
    var transaction = {
      id: id || uid("tx"),
      date: byId("transactionDate").value || todayString(),
      kind: byId("transactionKind").value,
      channel: byId("transactionChannel").value,
      amount: readNumber("transactionAmount"),
      note: byId("transactionNote").value.trim()
    };

    if (transaction.amount <= 0) {
      window.alert("Informe um valor maior que zero.");
      return;
    }

    if (id) {
      state.transactions = state.transactions.map(function (item) {
        return item.id === id ? transaction : item;
      });
    } else {
      state.transactions.push(transaction);
    }

    saveState();
    resetTransactionForm();
    hideBankrollSection();
    renderAll();
  }

  function openDepositForm() {
    resetTransactionForm();
    showBankrollSection();
    byId("banca").classList.add("deposit-mode");
    byId("transactionKind").value = "deposit";
    byId("transactionFormTitle").textContent = "Depositar saldo";
    window.setTimeout(function () {
      byId("transactionAmount").focus();
    }, 80);
  }

  function handleTransactionAction(event) {
    var button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    var id = button.getAttribute("data-id");
    var action = button.getAttribute("data-action");
    var tx = state.transactions.find(function (item) { return item.id === id; });

    if (!tx) {
      return;
    }

    if (action === "edit-transaction") {
      byId("transactionId").value = tx.id;
      byId("transactionDate").value = tx.date;
      byId("transactionKind").value = tx.kind;
      byId("transactionChannel").value = tx.channel;
      byId("transactionAmount").value = tx.amount;
      byId("transactionNote").value = tx.note || "";
      byId("transactionFormTitle").textContent = "Editar lançamento";
      byId("cancelTransactionEdit").classList.remove("hidden");
      showBankrollSection();
      byId("banca").classList.remove("deposit-mode");
      return;
    }

    if (action === "delete-transaction" && window.confirm("Excluir este lançamento de banca?")) {
      state.transactions = state.transactions.filter(function (item) { return item.id !== id; });
      saveState();
      renderAll();
    }
  }

  function handleSessionSubmit(event) {
    event.preventDefault();
    updateSessionCalculatedFields();

    var id = byId("sessionId").value;
    var session = {
      id: id || uid("session"),
      date: byId("sessionDate").value || todayString(),
      channel: byId("sessionChannel").value,
      modality: byId("sessionModality").value,
      venue: byId("sessionVenue").value.trim(),
      buyIn: readNumber("sessionBuyIn"),
      entries: Math.max(1, Math.round(readNumber("sessionEntries") || 1)),
      invested: readNumber("sessionInvested"),
      payout: readNumber("sessionPayout"),
      netResult: readNumber("sessionNet"),
      hours: readNumber("sessionHours"),
      notes: byId("sessionNotes").value.trim(),
      tilt: byId("sessionTilt").checked,
      stopRespected: byId("sessionStopRespected").checked,
      errors: byId("sessionErrors").value.trim(),
      createdAt: id ? getExistingSession(id).createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!session.venue) {
      window.alert("Informe a sala ou local da sessão.");
      return;
    }

    if (session.buyIn <= 0 || session.invested <= 0) {
      window.alert("Informe buy-in e investimento maiores que zero.");
      return;
    }

    var risk = getSessionRisk(session);
    if (risk.isRisky) {
      var proceed = window.confirm("Esse buy-in está acima do recomendado para sua banca atual. Máximo seguro: " + money(risk.maxBuyIn) + ". Deseja salvar mesmo assim?");
      if (!proceed) {
        return;
      }
    }

    if (id) {
      state.sessions = state.sessions.map(function (item) {
        return item.id === id ? session : item;
      });
    } else {
      state.sessions.push(session);
    }

    saveState();
    resetSessionForm();
    renderAll();
  }

  function handleSessionAction(event) {
    var button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    var id = button.getAttribute("data-id");
    var action = button.getAttribute("data-action");
    var session = state.sessions.find(function (item) { return item.id === id; });

    if (!session) {
      return;
    }

    if (action === "edit-session") {
      byId("sessionId").value = session.id;
      byId("sessionDate").value = session.date;
      byId("sessionChannel").value = session.channel;
      byId("sessionModality").value = session.modality;
      byId("sessionVenue").value = session.venue;
      byId("sessionBuyIn").value = session.buyIn;
      byId("sessionEntries").value = session.entries;
      byId("sessionInvested").value = session.invested;
      byId("sessionPayout").value = session.payout;
      byId("sessionNet").value = session.netResult;
      byId("sessionHours").value = session.hours;
      byId("sessionNotes").value = session.notes;
      byId("sessionTilt").checked = session.tilt;
      byId("sessionStopRespected").checked = session.stopRespected;
      byId("sessionErrors").value = session.errors;
      byId("sessionFormTitle").textContent = "Editar sessão";
      byId("cancelSessionEdit").classList.remove("hidden");
      byId("sessoes").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (action === "delete-session" && window.confirm("Excluir esta sessão?")) {
      state.sessions = state.sessions.filter(function (item) { return item.id !== id; });
      delete state.reviews[id];
      saveState();
      renderAll();
    }
  }

  function handleSettingsSubmit(event) {
    event.preventDefault();
    state.settings = {
      dailyStopLoss: readNumber("dailyStopLoss"),
      dailyStopWin: readNumber("dailyStopWin"),
      maxSessionsPerDay: Math.floor(readNumber("maxSessionsPerDay")),
      maxLostBuyinsPerDay: readNumber("maxLostBuyinsPerDay")
    };
    saveState();
    renderAll();
  }

  function handleReviewAction(event) {
    var button = event.target.closest("button[data-action='save-lesson']");
    if (!button) {
      return;
    }

    var card = button.closest("[data-session-id]");
    var sessionId = card.getAttribute("data-session-id");
    var textarea = card.querySelector("textarea");

    state.reviews[sessionId] = {
      lesson: textarea.value.trim(),
      updatedAt: new Date().toISOString()
    };

    saveState();
    setText("reviewMessage", "Lição salva.");
    window.setTimeout(function () {
      setText("reviewMessage", "");
    }, 2200);
  }

  function handleGoalSubmit(event) {
    event.preventDefault();

    var id = byId("goalId").value;
    var goal = {
      id: id || uid("goal"),
      name: byId("goalName").value.trim(),
      target: readNumber("goalTarget"),
      current: readNumber("goalCurrent"),
      deadline: byId("goalDeadline").value || todayString(),
      status: byId("goalStatus").value,
      createdAt: id ? getExistingGoal(id).createdAt : new Date().toISOString()
    };

    if (!goal.name) {
      window.alert("Informe o nome da meta.");
      return;
    }

    if (goal.target <= 0) {
      window.alert("Informe um valor alvo maior que zero.");
      return;
    }

    if (id) {
      state.goals = state.goals.map(function (item) {
        return item.id === id ? goal : item;
      });
    } else {
      state.goals.push(goal);
    }

    saveState();
    resetGoalForm();
    renderAll();
  }

  function handleGoalAction(event) {
    var button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    var id = button.getAttribute("data-id");
    var action = button.getAttribute("data-action");
    var goal = state.goals.find(function (item) { return item.id === id; });

    if (!goal) {
      return;
    }

    if (action === "edit-goal") {
      byId("goalId").value = goal.id;
      byId("goalName").value = goal.name;
      byId("goalTarget").value = goal.target;
      byId("goalCurrent").value = goal.current;
      byId("goalDeadline").value = goal.deadline;
      byId("goalStatus").value = goal.status;
      byId("goalFormTitle").textContent = "Editar meta";
      byId("cancelGoalEdit").classList.remove("hidden");
      byId("metas").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (action === "delete-goal" && window.confirm("Excluir esta meta?")) {
      state.goals = state.goals.filter(function (item) { return item.id !== id; });
      saveState();
      renderAll();
    }
  }

  function resetTransactionForm() {
    byId("transactionForm").reset();
    byId("transactionId").value = "";
    byId("transactionDate").value = todayString();
    byId("transactionFormTitle").textContent = "Novo lançamento";
    byId("cancelTransactionEdit").classList.add("hidden");
  }

  function showBankrollSection() {
    byId("banca").classList.remove("hidden-section");
    byId("banca").setAttribute("aria-hidden", "false");
  }

  function hideBankrollSection() {
    byId("banca").classList.add("hidden-section");
    byId("banca").classList.remove("deposit-mode");
    byId("banca").setAttribute("aria-hidden", "true");
  }

  function resetSessionForm() {
    byId("sessionForm").reset();
    byId("sessionId").value = "";
    byId("sessionDate").value = todayString();
    byId("sessionEntries").value = 1;
    byId("sessionStopRespected").checked = true;
    byId("sessionFormTitle").textContent = "Nova sessão";
    byId("cancelSessionEdit").classList.add("hidden");
    updateSessionCalculatedFields();
  }

  function resetGoalForm() {
    byId("goalForm").reset();
    byId("goalId").value = "";
    byId("goalDeadline").value = todayString();
    byId("goalFormTitle").textContent = "Nova meta";
    byId("cancelGoalEdit").classList.add("hidden");
  }

  function updateSessionCalculatedFields() {
    var buyIn = readNumber("sessionBuyIn");
    var entries = Math.max(1, Math.round(readNumber("sessionEntries") || 1));
    var invested = buyIn * entries;
    var payout = readNumber("sessionPayout");
    byId("sessionEntries").value = entries;
    byId("sessionInvested").value = formatRawNumber(invested);
    byId("sessionNet").value = formatRawNumber(payout - invested);
  }

  function clearReportFilters() {
    byId("filterStartDate").value = "";
    byId("filterEndDate").value = "";
    byId("filterModality").value = "all";
    byId("filterChannel").value = "all";
    byId("filterVenue").value = "";
    byId("filterTilt").value = "all";
    byId("filterResult").value = "all";
    renderReports();
  }

  function exportJson() {
    var backup = {
      app: "Controle de Bankroll de Poker",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state
    };
    downloadFile("backup-bankroll-poker-" + todayString() + ".json", JSON.stringify(backup, null, 2), "application/json");
    setText("backupMessage", "Backup JSON exportado.");
  }

  function importJson(event) {
    var file = event.target.files[0];
    if (!file) {
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = normalizeState(JSON.parse(String(reader.result)));
        if (!window.confirm("Importar este backup vai substituir os dados atuais neste navegador. Continuar?")) {
          return;
        }
        state = imported;
        saveState();
        renderAll();
        setText("backupMessage", "Backup importado com sucesso.");
      } catch (error) {
        window.alert("Não foi possível importar o JSON. Verifique o arquivo.");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function exportSessionsCsv() {
    var headers = [
      "Data",
      "Tipo",
      "Modalidade",
      "Sala/local",
      "Buy-in",
      "Entradas/rebuys",
      "Valor total investido",
      "Valor ganho/retirado",
      "Resultado líquido",
      "Horas jogadas",
      "Houve tilt",
      "Respeitou stop loss",
      "Observações",
      "Erros cometidos",
      "Lição aprendida"
    ];

    var rows = state.sessions.slice().sort(sortByDateAsc).map(function (session) {
      var review = state.reviews[session.id] || {};
      return [
        session.date,
        channelLabel(session.channel),
        modalityLabel(session.modality),
        session.venue,
        formatRawNumber(session.buyIn),
        session.entries,
        formatRawNumber(getSessionInvested(session)),
        formatRawNumber(session.payout),
        formatRawNumber(getSessionNet(session)),
        formatRawNumber(session.hours),
        session.tilt ? "Sim" : "Não",
        session.stopRespected ? "Sim" : "Não",
        session.notes,
        session.errors,
        review.lesson || ""
      ];
    });

    var csv = [headers].concat(rows).map(function (row) {
      return row.map(csvEscape).join(",");
    }).join("\n");

    downloadFile("sessoes-bankroll-poker-" + todayString() + ".csv", "\uFEFF" + csv, "text/csv;charset=utf-8");
    setText("backupMessage", "CSV de sessões exportado.");
  }

  function clearAllData() {
    var confirmed = window.confirm("Apagar todos os dados salvos neste navegador? Essa ação não pode ser desfeita.");
    if (!confirmed) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    state = cloneDefaults();
    resetTransactionForm();
    resetSessionForm();
    resetGoalForm();
    renderAll();
    setText("backupMessage", "Todos os dados foram apagados.");
  }

  function getBankrollByChannel(channel) {
    var transactionTotal = state.transactions.reduce(function (total, tx) {
      return tx.channel === channel ? total + getTransactionAmount(tx) : total;
    }, 0);

    var sessionTotal = state.sessions.reduce(function (total, session) {
      return session.channel === channel ? total + getSessionNet(session) : total;
    }, 0);

    return transactionTotal + sessionTotal;
  }

  function getTotalBankroll() {
    return getBankrollByChannel("online") + getBankrollByChannel("live");
  }

  function getTotalSessionProfit(sessions) {
    return sessions.reduce(function (total, session) {
      return total + getSessionNet(session);
    }, 0);
  }

  function getTotalInvested(sessions) {
    return sessions.reduce(function (total, session) {
      return total + getSessionInvested(session);
    }, 0);
  }

  function getTotalHours(sessions) {
    return sessions.reduce(function (total, session) {
      return total + positiveNumber(session.hours);
    }, 0);
  }

  function getAbi() {
    var tournamentLike = state.sessions.filter(function (session) {
      return ["torneio", "sitgo", "spin"].indexOf(session.modality) >= 0;
    });
    var entries = tournamentLike.reduce(function (total, session) {
      return total + positiveNumber(session.entries);
    }, 0);
    var invested = getTotalInvested(tournamentLike);
    return entries > 0 ? invested / entries : 0;
  }

  function getCashWinrate() {
    var cashSessions = state.sessions.filter(function (session) {
      return session.modality === "cash";
    });
    var hours = getTotalHours(cashSessions);
    return hours > 0 ? getTotalSessionProfit(cashSessions) / hours : 0;
  }

  function calculateSwings() {
    var sorted = state.sessions.slice().sort(sortByDateAsc);
    var cumulative = 0;
    var peak = 0;
    var trough = 0;
    var maxUpswing = 0;
    var maxDownswing = 0;

    sorted.forEach(function (session) {
      cumulative += getSessionNet(session);
      if (cumulative - trough > maxUpswing) {
        maxUpswing = cumulative - trough;
      }
      if (peak - cumulative > maxDownswing) {
        maxDownswing = peak - cumulative;
      }
      if (cumulative > peak) {
        peak = cumulative;
      }
      if (cumulative < trough) {
        trough = cumulative;
      }
    });

    return {
      upswing: maxUpswing,
      downswing: maxDownswing
    };
  }

  function getBankrollEvents() {
    var transactionEvents = state.transactions.map(function (tx) {
      return {
        date: tx.date,
        createdAt: tx.id,
        amount: getTransactionAmount(tx)
      };
    });

    var sessionEvents = state.sessions.map(function (session) {
      return {
        date: session.date,
        createdAt: session.createdAt || session.id,
        amount: getSessionNet(session)
      };
    });

    return transactionEvents.concat(sessionEvents).sort(function (a, b) {
      return sortDateValues(a.date, b.date) || String(a.createdAt).localeCompare(String(b.createdAt));
    });
  }

  function getRequiredBuyins(modality, channel) {
    if (modality === "spin") {
      return 150;
    }
    if (modality === "cash") {
      return channel === "live" ? 30 : 40;
    }
    if (modality === "torneio" || modality === "sitgo") {
      return channel === "live" ? 50 : 100;
    }
    return channel === "live" ? 50 : 100;
  }

  function getMaxBuyIn(channel, modality) {
    var required = getRequiredBuyins(modality, channel);
    return getBankrollByChannel(channel) / required;
  }

  function getSessionRisk(session) {
    var maxBuyIn = getMaxBuyIn(session.channel, session.modality);
    return {
      required: getRequiredBuyins(session.modality, session.channel),
      maxBuyIn: maxBuyIn,
      isRisky: positiveNumber(session.buyIn) > 0 && positiveNumber(session.buyIn) > maxBuyIn
    };
  }

  function getRiskySessions() {
    return state.sessions.filter(function (session) {
      return getSessionRisk(session).isRisky;
    }).sort(sortByDateDesc);
  }

  function getTodaySessions() {
    var today = todayString();
    return state.sessions.filter(function (session) {
      return session.date === today;
    });
  }

  function getLostBuyins(sessions) {
    return sessions.reduce(function (total, session) {
      var net = getSessionNet(session);
      if (net >= 0 || !session.buyIn) {
        return total;
      }
      return total + Math.abs(net) / session.buyIn;
    }, 0);
  }

  function getStopMessages() {
    var todaySessions = getTodaySessions();
    var todayProfit = getTotalSessionProfit(todaySessions);
    var lostBuyins = getLostBuyins(todaySessions);
    var settings = state.settings;
    var messages = [];

    if (settings.dailyStopLoss > 0 && todayProfit <= -settings.dailyStopLoss) {
      messages.push("Stop loss diário atingido.");
    }
    if (settings.dailyStopWin > 0 && todayProfit >= settings.dailyStopWin) {
      messages.push("Stop win diário atingido.");
    }
    if (settings.maxSessionsPerDay > 0 && todaySessions.length >= settings.maxSessionsPerDay) {
      messages.push("Limite máximo de sessões por dia atingido.");
    }
    if (settings.maxLostBuyinsPerDay > 0 && lostBuyins >= settings.maxLostBuyinsPerDay) {
      messages.push("Limite máximo de buy-ins perdidos por dia atingido.");
    }

    return messages;
  }

  function getFilteredSessions() {
    var start = byId("filterStartDate").value;
    var end = byId("filterEndDate").value;
    var modality = byId("filterModality").value;
    var channel = byId("filterChannel").value;
    var venue = byId("filterVenue").value.trim().toLowerCase();
    var tilt = byId("filterTilt").value;
    var result = byId("filterResult").value;

    return state.sessions.filter(function (session) {
      var net = getSessionNet(session);
      if (start && session.date < start) {
        return false;
      }
      if (end && session.date > end) {
        return false;
      }
      if (modality !== "all" && session.modality !== modality) {
        return false;
      }
      if (channel !== "all" && session.channel !== channel) {
        return false;
      }
      if (venue && String(session.venue || "").toLowerCase().indexOf(venue) === -1) {
        return false;
      }
      if (tilt === "yes" && !session.tilt) {
        return false;
      }
      if (tilt === "no" && session.tilt) {
        return false;
      }
      if (result === "positive" && net <= 0) {
        return false;
      }
      if (result === "negative" && net >= 0) {
        return false;
      }
      return true;
    }).sort(sortByDateAsc);
  }

  function groupProfit(sessions, getKey) {
    return sessions.reduce(function (groups, session) {
      var key = getKey(session) || "Sem informação";
      groups[key] = (groups[key] || 0) + getSessionNet(session);
      return groups;
    }, {});
  }

  function renderGroupProfit(targetId, groups) {
    var entries = Object.keys(groups).map(function (key) {
      return { key: key, value: groups[key] };
    }).sort(function (a, b) {
      return Math.abs(b.value) - Math.abs(a.value);
    });

    byId(targetId).innerHTML = entries.length
      ? entries.map(function (entry) {
          return '<div class="mini-row"><span>' + escapeHtml(entry.key) + '</span><strong class="' + toneClass(entry.value) + '">' + escapeHtml(money(entry.value)) + '</strong></div>';
        }).join("")
      : '<div class="empty-state">Sem sessões para o filtro atual.</div>';
  }

  function renderRepeatedErrors(sessions) {
    var counts = {};
    sessions.forEach(function (session) {
      splitErrors(session.errors).forEach(function (error) {
        counts[error] = (counts[error] || 0) + 1;
      });
    });

    var entries = Object.keys(counts).map(function (key) {
      return { key: key, count: counts[key] };
    }).sort(function (a, b) {
      return b.count - a.count || a.key.localeCompare(b.key);
    }).slice(0, 10);

    if (!entries.length) {
      return '<div class="empty-state">Nenhum erro recorrente encontrado.</div>';
    }

    return entries.map(function (entry) {
      return '<div class="mini-row"><span>' + escapeHtml(entry.key) + '</span><strong>' + entry.count + 'x</strong></div>';
    }).join("");
  }

  function reviewCardHtml(session) {
    var review = state.reviews[session.id] || {};
    var net = getSessionNet(session);
    return '<article class="review-card" data-session-id="' + escapeHtml(session.id) + '">' +
      '<header>' +
        '<div><h4>' + escapeHtml(formatDate(session.date) + " · " + session.venue) + '</h4><p>' + escapeHtml(modalityLabel(session.modality) + " · " + channelLabel(session.channel)) + '</p></div>' +
        '<strong class="' + toneClass(net) + '">' + escapeHtml(money(net)) + '</strong>' +
      '</header>' +
      (session.errors ? '<p><strong>Erros:</strong> ' + escapeHtml(session.errors) + '</p>' : '') +
      (session.notes ? '<p><strong>Obs.:</strong> ' + escapeHtml(session.notes) + '</p>' : '') +
      '<label>Lição aprendida<textarea rows="3" maxlength="500">' + escapeHtml(review.lesson || "") + '</textarea></label>' +
      '<div class="form-actions"><button class="btn secondary small" type="button" data-action="save-lesson">Salvar lição</button></div>' +
    '</article>';
  }

  function metricRow(label, value, toneValue) {
    var cls = typeof toneValue === "number" ? toneClass(toneValue) : "";
    return '<div class="metric-row"><span>' + escapeHtml(label) + '</span><strong class="' + cls + '">' + escapeHtml(String(value)) + '</strong></div>';
  }

  function actionButton(action, id, label, variant) {
    return '<button class="btn small ' + (variant === "danger" ? "danger" : "ghost") + '" type="button" data-action="' + escapeHtml(action) + '" data-id="' + escapeHtml(id) + '">' + escapeHtml(label) + '</button>';
  }

  function alertHtml(type, title, message) {
    return '<div class="alert ' + escapeHtml(type) + '"><strong>' + escapeHtml(title) + '</strong>' + escapeHtml(message) + '</div>';
  }

  function emptyRow(colspan, message) {
    return '<tr><td colspan="' + colspan + '"><div class="empty-state">' + escapeHtml(message) + '</div></td></tr>';
  }

  function splitErrors(text) {
    return String(text || "")
      .split(/[\n,;.]+/)
      .map(function (item) {
        return item.trim().toLowerCase();
      })
      .filter(function (item) {
        return item.length > 2;
      });
  }

  function getTransactionAmount(tx) {
    var value = positiveNumber(tx.amount);
    return tx.kind === "withdrawal" ? -value : value;
  }

  function getSessionInvested(session) {
    return positiveNumber(session.invested !== undefined ? session.invested : session.buyIn * session.entries);
  }

  function getSessionNet(session) {
    if (session.netResult !== undefined && session.netResult !== null) {
      return numberOrZero(session.netResult);
    }
    return positiveNumber(session.payout) - getSessionInvested(session);
  }

  function getExistingSession(id) {
    return state.sessions.find(function (session) { return session.id === id; }) || {};
  }

  function getExistingGoal(id) {
    return state.goals.find(function (goal) { return goal.id === id; }) || {};
  }

  function getGoalProgress(goal) {
    if (!goal.target) {
      return 0;
    }
    return Math.max(0, Math.min(100, (goal.current / goal.target) * 100));
  }

  function resolveGoalStatus(goal) {
    if (goal.current >= goal.target && goal.target > 0) {
      return "concluida";
    }
    if (goal.deadline && goal.deadline < todayString()) {
      return "atrasada";
    }
    return goal.status || "andamento";
  }

  function goalStatusLabel(status) {
    return {
      andamento: "Em andamento",
      concluida: "Concluída",
      atrasada: "Atrasada"
    }[status] || "Em andamento";
  }

  function goalStatusClass(status) {
    if (status === "concluida") {
      return "positive";
    }
    if (status === "atrasada") {
      return "negative";
    }
    return "warning";
  }

  function normalizeModality(value) {
    return ["torneio", "cash", "sitgo", "spin", "outro"].indexOf(value) >= 0 ? value : "outro";
  }

  function modalityLabel(value) {
    return {
      torneio: "Torneio",
      cash: "Cash game",
      sitgo: "Sit and Go",
      spin: "Spin",
      outro: "Outro"
    }[value] || "Outro";
  }

  function channelLabel(value) {
    return value === "live" ? "Ao vivo" : "Online";
  }

  function transactionKindLabel(value) {
    return {
      initial: "Banca inicial",
      deposit: "Depósito",
      withdrawal: "Saque"
    }[value] || "Depósito";
  }

  function sortByDateAsc(a, b) {
    return sortDateValues(a.date, b.date) || String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id));
  }

  function sortByDateDesc(a, b) {
    return sortDateValues(b.date, a.date) || String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id));
  }

  function sortDateValues(a, b) {
    return String(a || "").localeCompare(String(b || ""));
  }

  function readNumber(id) {
    return numberOrZero(byId(id).value);
  }

  function numberOrZero(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    var normalized = String(value || "").trim().replace(/\s/g, "");
    var hasComma = normalized.indexOf(",") >= 0;
    var hasDot = normalized.indexOf(".") >= 0;

    if (hasComma && hasDot) {
      if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
        normalized = normalized.replace(/\./g, "").replace(",", ".");
      } else {
        normalized = normalized.replace(/,/g, "");
      }
    } else if (hasComma) {
      normalized = normalized.replace(",", ".");
    }

    normalized = normalized.replace(/[^0-9.-]/g, "");
    var number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function positiveNumber(value) {
    return Math.max(0, numberOrZero(value));
  }

  function formatRawNumber(value) {
    return (Math.round(numberOrZero(value) * 100) / 100).toFixed(2);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(numberOrZero(value));
  }

  function money(value) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(numberOrZero(value));
  }

  function percent(value) {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numberOrZero(value)) + "%";
  }

  function todayString() {
    var date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }
    var parts = String(value).split("-");
    if (parts.length !== 3) {
      return value;
    }
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function toneClass(value) {
    if (value > 0) {
      return "positive";
    }
    if (value < 0) {
      return "negative";
    }
    return "";
  }

  function setTone(id, value) {
    byId(id).className = toneClass(value);
  }

  function setText(id, text) {
    byId(id).textContent = text;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeSvg(value) {
    return escapeHtml(value);
  }

  function csvEscape(value) {
    var text = String(value === undefined || value === null ? "" : value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function downloadFile(filename, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function flashStorageStatus() {
    var status = byId("storageStatus");
    if (!status) {
      return;
    }
    status.textContent = "Dados salvos";
    window.clearTimeout(flashStorageStatus.timer);
    flashStorageStatus.timer = window.setTimeout(function () {
      status.textContent = "Salvo no navegador";
    }, 1800);
  }
})();
