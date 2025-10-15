// ====================================================================================================
// 1. DATA Y CONFIGURACIÓN CRÍTICA
// ====================================================================================================

// 🛑 ¡PUNTO CRÍTICO! REEMPLAZA ESTA URL CON LA DE TU PROPIO DESPLIEGUE.
const API_URL = 'https://script.google.com/macros/s/AKfycbzDjq01yI157yqVUnRddgOrZS0Y7i2Vsdq23CD39lqoF6cHTNDiFYerxYRqXo2vE2Uysw/exec';

let currentSheet = "Verificacion de Baterias/Patrullas";
let sheetData = [];
let repeatedChecksAnalysis = {}; // Variable global para almacenar el resultado del análisis
let activeSupervisorEmail = null; // Variable de estado del recorrido

// Referencias del DOM
const dataContainer = document.getElementById('dataContainer');
const searchInput = document.getElementById('searchInput');
const alertFilter = document.getElementById('alertFilter');
const countDisplay = document.getElementById('countDisplay');
const detailsModal = document.getElementById('detailsModal');
const modalBody = document.getElementById('modalBody');
const closeModal = document.querySelector('.close-button');
const tabButtons = document.querySelectorAll('.tab-button');

// Referencias del DOM para la VISIBILIDAD y RECORRIDO (Aseguradas)
const supervisorSummary = document.getElementById('supervisorSummary');
const recorridoContainer = document.getElementById('recorridoContainer');
const recorridoInstructions = document.getElementById('recorridoInstructions');
const resultsTitle = document.getElementById('resultsTitle');
const recorridoDateSelector = document.getElementById('recorridoDateSelector');
const summarySection = document.querySelector('.summary-section'); // La sección principal de supervisores/fecha
const dataDisplaySection = document.querySelector('.data-display'); // El contenedor de la tabla/tarjetas
const repetitionAnalysisContainer = document.getElementById('repetitionAnalysisContainer'); // Contenedor del análisis de repeticiones
const filterBar = document.querySelector('.filter-bar'); // Si usas una clase genérica para la barra de filtros

// ====================================================================================================
// 1.5. DATA Y LÓGICA DE ANÁLISIS DE REPETICIONES
// (El código de `analyzeRepeatedChecks`, `renderRepetitionAnalysis` y `window.toggleRepetitionDetails` se mantiene igual)
// ====================================================================================================

/**
 * Analiza el objeto agrupado por supervisor/día para encontrar objetivos visitados
 * por más de un supervisor el mismo día.
 * @param {object} allRecorridoData - El objeto agrupado por emailSupervisor y día.
 */
const analyzeRepeatedChecks = (allRecorridoData) => {
    const repeatsByDate = {}; // { 'YYYY-MM-DD': { 'Objetivo A': [sup1@, sup2@], ... } }

    Object.keys(allRecorridoData).forEach(emailSupervisor => {
        const checkData = allRecorridoData[emailSupervisor];

        Object.keys(checkData).forEach(dayISO => {
            if (!repeatsByDate[dayISO]) {
                repeatsByDate[dayISO] = {};
            }

            // Agrupamos por el nombre de la ubicación para contar supervisores
            checkData[dayISO].forEach(check => {
                const objective = check.patrullaNombre;
                if (!objective) return;

                if (!repeatsByDate[dayISO][objective]) {
                    repeatsByDate[dayISO][objective] = new Set();
                }
                repeatsByDate[dayISO][objective].add(emailSupervisor);
            });
        });
    });

    // Filtramos solo las entradas con más de un supervisor
    const finalRepeats = {};
    Object.keys(repeatsByDate).forEach(dayISO => {
        const dayRepeats = {};
        Object.keys(repeatsByDate[dayISO]).forEach(objective => {
            const supervisors = Array.from(repeatsByDate[dayISO][objective]);

            if (supervisors.length > 1) {
                // Limpiar el email a solo el nombre para el display
                dayRepeats[objective] = supervisors.map(email => email.split('@')[0]);
            }
        });

        if (Object.keys(dayRepeats).length > 0) {
            finalRepeats[dayISO] = dayRepeats;
        }
    });

    return finalRepeats;
};

/**
 * Renderiza los resultados del análisis de repeticiones en el DOM.
 */
const renderRepetitionAnalysis = (analysisData) => {
    const container = repetitionAnalysisContainer;
    const resultsDiv = document.getElementById('repetitionResults');
    const countSpan = document.getElementById('repetitionCount');
    const toggleButton = document.getElementById('toggleRepetitionsBtn');

    if (!container || !resultsDiv) return;

    const daysWithRepeats = Object.keys(analysisData).length;
    countSpan.textContent = daysWithRepeats;

    if (daysWithRepeats === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    // Inicialmente oculto
    let detailsHtml = '<div id="repetitionDetails" style="display: none;">';

    Object.keys(analysisData).sort().reverse().forEach(dayISO => {
        const objectives = analysisData[dayISO];
        const dateDisplay = new Date(dayISO + 'T00:00:00').toLocaleDateString();

        detailsHtml += `<div class="card p-2 mt-2">
            <h6>📅 ${dateDisplay} (${Object.keys(objectives).length} objetivos repetidos)</h6>
            <ul class="list-group list-group-flush mt-1">`;

        Object.keys(objectives).forEach(objective => {
            const supervisors = objectives[objective].join(', ');
            detailsHtml += `<li class="list-group-item d-flex justify-content-between align-items-center text-danger list-group-item-danger">
                <span>📍 <strong>${objective}</strong></span>
                <span class="badge bg-danger text-white">Supervisores: ${supervisors}</span>
            </li>`;
        });

        detailsHtml += `</ul></div>`;
    });

    detailsHtml += '</div>';
    resultsDiv.innerHTML = detailsHtml;

    // Aseguramos que el estado del botón refleje que los detalles están ocultos inicialmente
    if (toggleButton) toggleButton.textContent = 'Ver Detalles';
};

// Función global para mostrar/ocultar los detalles de repetición
window.toggleRepetitionDetails = () => {
    const details = document.getElementById('repetitionDetails');
    const button = document.getElementById('toggleRepetitionsBtn');

    if (!details || !button) return;

    const isVisible = details.style.display !== 'none';
    details.style.display = isVisible ? 'none' : 'block';
    button.textContent = isVisible ? 'Ver Detalles' : 'Ocultar Detalles';
};


// ====================================================================================================
// 2. FUNCIONES DE CARGA Y ORDENAMIENTO
// ====================================================================================================

/**
 * Función auxiliar para obtener un valor numérico (milisegundos) comparable basado en la fecha y hora.
 */
const getDateSortValue = (timestampString) => {
    if (!timestampString) return 0;

    const [datePartWithSpaces, timePartWithSpaces] = timestampString.split(', ');

    let datePart = datePartWithSpaces ? datePartWithSpaces.trim() : null;
    let timePart = timePartWithSpaces ? timePartWithSpaces.trim() : null;

    if (!datePart || !timePart) {
        const parts = timestampString.trim().split(' ');
        if (parts.length >= 2) {
            timePart = parts.pop();
            datePart = parts.join(' ');
        } else {
            return 0;
        }
    }

    const dateParts = datePart.split('/');
    if (dateParts.length !== 3) return 0;

    const day = parseInt(dateParts[0]);
    const monthIndex = parseInt(dateParts[1]) - 1;
    const year = parseInt(dateParts[2]);

    const timeElements = timePart.split(' ');
    const hms = timeElements[0];
    const ampm = timeElements.length > 1 ? timeElements[1] : '';

    const [rawHour, minute, second] = hms.split(':').map(n => parseInt(n));
    if (isNaN(rawHour) || isNaN(minute) || isNaN(second)) return 0;

    let hour = rawHour;

    if (ampm && ampm.toLowerCase() === 'p.m.' && hour !== 12) {
        hour += 12;
    } else if (ampm && ampm.toLowerCase() === 'a.m.' && hour === 12) {
        hour = 0;
    }

    const dateObj = new Date(year, monthIndex, day, hour, minute, second);

    return isNaN(dateObj.getTime()) ? 0 : dateObj.getTime();
};


const loadData = async (sheetName) => {
    currentSheet = sheetName;
    const isRecorridoTab = sheetName === "Recorridos_Consolidados";

    console.log(`LOAD DATA: Pestaña cargada: ${sheetName}. Es Recorrido? ${isRecorridoTab}`);

    // 🚨 CONTROL DE VISIBILIDAD CRÍTICO (Ajuste para móvil/desktop)
    if (summarySection) {
        const newDisplay = isRecorridoTab ? 'flex' : 'none';
        summarySection.style.display = newDisplay;
        if (isRecorridoTab) summarySection.style.flexDirection = 'column'; // Lo mantiene apilado

        console.log(`VISIBILITY LOG: summarySection display set to: ${newDisplay}`);
    }
    
    if (dataDisplaySection) {
        const newDisplay = isRecorridoTab ? 'none' : 'block';
        dataDisplaySection.style.display = newDisplay;
        console.log(`VISIBILITY LOG: dataDisplaySection display set to: ${newDisplay}`);
    }

    // Oculta/Muestra los filtros estándar
    if (searchInput) searchInput.style.display = isRecorridoTab ? 'none' : 'block';
    if (alertFilter) alertFilter.style.display = isRecorridoTab ? 'none' : 'block';
    if (filterBar) filterBar.style.display = isRecorridoTab ? 'none' : 'flex'; // Asumiendo que filter-bar contiene searchInput/alertFilter

    // 1. Limpieza y mensajes de carga
    if (dataContainer) {
        dataContainer.innerHTML = `<p class="loading-message">Cargando datos de **${sheetName}**, por favor espere...</p>`;
    }
    if (supervisorSummary) {
        if (isRecorridoTab) {
            supervisorSummary.innerHTML = '<h4>Supervisores y Cantidad de Chequeos Consolidados:</h4><p>Cargando sumario...</p>';
        } else {
             // Limpia el contenido de la sección de recorrido si cambiamos a una pestaña normal
             if (recorridoContainer) recorridoContainer.innerHTML = '';
             if (recorridoInstructions) recorridoInstructions.textContent = 'Selecciona un supervisor para ver su recorrido.';
             if (repetitionAnalysisContainer) repetitionAnalysisContainer.style.display = 'none'; // Ocultar el análisis
        }
    }

    const fullUrl = `${API_URL}?sheet=${encodeURIComponent(sheetName)}`;

    try {
        const response = await fetch(fullUrl);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        sheetData = data;

        // Ordenamiento DESCENDENTE (Más Reciente a Más Antiguo)
        sheetData.sort((a, b) => {
            const sortValueA = getDateSortValue(a.timestamp);
            const sortValueB = getDateSortValue(b.timestamp);
            return sortValueB - sortValueA;
        });

        // 4. Actualizar UI
        if (!isRecorridoTab) {
            sheetData = checkInactivity(sheetData);
            window.filterAndSearch();

        } else {
            // Ejecutar el sumario y obtener los datos agrupados por supervisor y día
            const allRecorridoData = updateSummaryData(sheetData);

            // 🎯 1.B: EJECUTAR EL ANÁLISIS DE REPETICIONES
            repeatedChecksAnalysis = analyzeRepeatedChecks(allRecorridoData);

            // 🎯 1.B: RENDERIZAR LA SECCIÓN DEL ANÁLISIS
            renderRepetitionAnalysis(repeatedChecksAnalysis);

            // Resetea la vista de recorrido al cargar nuevos datos
            if (recorridoInstructions) recorridoInstructions.textContent = 'Selecciona un supervisor para ver su recorrido.';
            if (recorridoContainer) recorridoContainer.innerHTML = '';
            activeSupervisorEmail = null;
        }

    } catch (error) {
        console.error("Fallo al obtener los datos:", error);
        if (dataContainer) {
             dataContainer.innerHTML = `<p class="text-danger">❌ **Error de Conexión/Datos:** Verifique la URL de la API y el formato de los datos. Error: ${error.message}</p>`;
        }
        if (countDisplay) countDisplay.textContent = 0;
        if (supervisorSummary && isRecorridoTab) {
             supervisorSummary.innerHTML = `<p class="text-danger">Error: No se pudo cargar el sumario.</p>`;
        }
    }
};

// ====================================================================================================
// 3. LÓGICA DE NEGOCIO Y ALERTAS
// (El código de `checkCombustible`, `isNegative`, `getBasesAlertDetails`, `hasAlert` y `checkInactivity` se mantiene igual)
// ====================================================================================================

const checkCombustible = (fraccion) => {
    if (fraccion === 'N/A' || !fraccion) return { valor: 100, alerta: false };
    const parts = fraccion.split('/');
    if (parts.length !== 2) return { valor: 100, alerta: false };

    const [num, den] = parts.map(n => parseInt(n.trim()));
    if (den === 0 || isNaN(num) || isNaN(den)) return { valor: 100, alerta: false };

    const valor = (num / den) * 100;
    // Se considera alerta si es menor o igual a 6/16 (~37.5%)
    return {
        valor: valor,
        alerta: valor <= (6/16 * 100)
    };
};

const isNegative = (value) => {
    if (!value) return false;
    const lowerValue = value.toString().toLowerCase().trim();
    return lowerValue === 'no' || lowerValue === 'regular' || lowerValue === 'mala';
};

const getBasesAlertDetails = (item) => {
    const faltas = [];
    const baseCheckFields = [
        { label: "Higiene de la Base", key: "higieneMovil" },
        { label: "Posee Botiquín", key: "poseeBotiquin" },
        { label: "Posee Auxilio", key: "poseeAuxilio" },
        { label: "Posee Matafuegos en vigencia", key: "poseeMatafuegos" },
        { label: "Posee Baliza", key: "poseeBaliza" },
        { label: "Posee Linterna", key: "poseeLinterna" },
        { label: "Posee Cable para puentear bateria", key: "poseeCableBateria" },
        { label: "Posee Capa de lluvia", key: "poseeCapaLluvia" },
        { label: "Posee toda la documentacion del movil", key: "poseeDocumentacionMovil" },
        { label: "Posee Linga", key: "poseeLinga" },
        { label: "Posee Cricket", key: "poseeCricket" },
        { label: "Posee Llave Cruz", key: "poseeLlaveCruz" },
    ];
    baseCheckFields.forEach(field => {
        const fieldValue = item[field.key];
        if (isNegative(fieldValue)) {
            const displayValue = fieldValue.toUpperCase();
            faltas.push(`${field.label}: ${displayValue}`);
        }
    });
    return faltas;
};

const hasAlert = (item) => {
    const isRecorridoCheck = currentSheet === "Recorridos_Consolidados";
    const sheetToCheck = isRecorridoCheck ? (item.HojaOrigen || currentSheet) : currentSheet;

    const checkMovil = sheetToCheck !== "Verificacion de objetivos MAC";
    const isBaseCheck = sheetToCheck === "verificacion de bases";

    // Alerta de bases
    if (isBaseCheck && getBasesAlertDetails(item).length > 0) {
        return true;
    }

    // Alerta de Combustible, Higiene o Botiquín (aplica si hay datos de móvil)
    if (checkMovil) {
        if (item.combustibleFraccion && checkCombustible(item.combustibleFraccion).alerta) return true;
        if (isNegative(item.poseeBotiquin)) return true;
        if (isNegative(item.higieneMovil)) return true;
    }

    // Alerta de Vigiladores
    if (item.vigiladores && item.vigiladores.length > 0) {
        const vigiladorAlerta = item.vigiladores.some(v =>
            isNegative(v.uniformeCompleto) ||
            isNegative(v.regControlado)
        );
        if (vigiladorAlerta) {
            return true;
        }
    }

    return false;
};

const checkInactivity = (data) => {
    if (data.length === 0) return data;

    const lastReports = {};
    data.forEach((item) => {
        const key = item.patrullaNombre;
        const sortValue = item.timestamp ? getDateSortValue(item.timestamp) : 0;

        if (!lastReports[key] || lastReports[key].sortValue < sortValue) {
            lastReports[key] = { sortValue: sortValue, timestamp: item.timestamp };
        }
    });

    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    return data.map((item) => {
        const key = item.patrullaNombre;
        const lastReport = lastReports[key];

        const lastReportDateMilli = lastReport ? lastReport.sortValue : 0;

        const hasPassedThreshold = lastReportDateMilli === 0 || (now - lastReportDateMilli) > twentyFourHours;

        const isLatestReport = item.timestamp && getDateSortValue(item.timestamp) === lastReport.sortValue;

        // La alerta de inactividad solo se aplica al reporte más reciente para esa ubicación
        item.inactividadAlerta = isLatestReport && hasPassedThreshold;

        return item;
    });
};

/**
 * Renderiza el sumario de supervisores para la pestaña consolidada.
 * Además, agrupa los datos por supervisor y día y los retorna para el análisis de repeticiones.
 * @returns {object} allRecorridoData - Datos agrupados por emailSupervisor y luego por día (ISO).
 */
const updateSummaryData = (data) => {
    const supervisorCounts = {};
    const allRecorridoData = {}; // Nuevo objeto para agrupar por supervisor Y día

    data.forEach(item => {
        const email = item.emailSupervisor;
        if (email && email.trim() !== '') {
            const key = email.trim().toLowerCase();
            const sortValue = getDateSortValue(item.timestamp);

            if (!supervisorCounts[key]) {
                supervisorCounts[key] = { count: 0, lastCheck: item.timestamp };
            }
            supervisorCounts[key].count++;

            // Mantiene el timestamp más reciente
            if (sortValue > getDateSortValue(supervisorCounts[key].lastCheck)) {
                 supervisorCounts[key].lastCheck = item.timestamp;
            }

            // --- LÓGICA DE AGRUPACIÓN POR DÍA (Para Recorridos y Análisis de Repeticiones) ---
            if (sortValue !== 0) {
                const dateObj = new Date(sortValue);
                const year = dateObj.getFullYear();
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                const day = String(dateObj.getDate()).padStart(2, '0');
                const dayKey = `${year}-${month}-${day}`;

                if (!allRecorridoData[key]) {
                    allRecorridoData[key] = {};
                }
                if (!allRecorridoData[key][dayKey]) {
                    allRecorridoData[key][dayKey] = [];
                }
                allRecorridoData[key][dayKey].push(item);
            }
            // ---------------------------------------------------------------------------------
        }
    });

    let html = '<h4>Supervisores y Cantidad de Chequeos Consolidados:</h4>';
    const sortedSupervisors = Object.entries(supervisorCounts).sort(([, a], [, b]) => b.count - a.count);

    if (sortedSupervisors.length === 0) {
        html += '<p class="text-info">No se encontraron chequeos para supervisores.</p>';
        if (supervisorSummary) supervisorSummary.innerHTML = html;
        if (recorridoContainer) recorridoContainer.innerHTML = '';
        if (recorridoInstructions) recorridoInstructions.textContent = 'No hay datos para mostrar.';
        return allRecorridoData;
    }

    html += '<ul class="supervisor-list">';
    sortedSupervisors.forEach(([email, details]) => {
        const name = email.split('@')[0];
        const lastDateDisplay = details.lastCheck ? details.lastCheck.split(',')[0].trim() : 'N/A';
        const isAlert = data.filter(item => item.emailSupervisor && item.emailSupervisor.toLowerCase() === email && hasAlert(item)).length > 0;

        html += `
             <li data-email="${email}" onclick="window.showSupervisorRecorrido('${email}')"
                 title="Ver recorrido de ${name}"
                 class="${isAlert ? 'list-alert' : ''}">
                 <strong>${name} ${isAlert ? '🚨' : ''}</strong>
                 <span>Chequeos: ${details.count}</span>
                 <span class="small-text">Último: ${lastDateDisplay}</span>
             </li>
          `;
    });

    html += '</ul>';
    if (supervisorSummary) supervisorSummary.innerHTML = html;

    return allRecorridoData;
};


// ====================================================================================================
// 4. LÓGICA DE RECORRIDO Y FILTRO DE FECHA
// (El código de `groupRecorridoByDay`, `getDisplayLocation`, `renderRecorridoForDate` y `showSupervisorRecorrido` se mantiene igual)
// ====================================================================================================

/**
 * Agrupa las verificaciones de un supervisor por día y asegura el orden cronológico.
 */
const groupRecorridoByDay = (data) => {
    const dailyRecorrido = {};

    data.forEach(item => {
        const sortValue = getDateSortValue(item.timestamp);
        if (sortValue === 0) return;

        const dateObj = new Date(sortValue);

        // Convertir a formato ISO YYYY-MM-DD para la clave (fácil de comparar con input[type=date])
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        const dayKey = `${year}-${month}-${day}`;

        if (!dailyRecorrido[dayKey]) {
            dailyRecorrido[dayKey] = [];
        }
        dailyRecorrido[dayKey].push(item);
    });

    // Ordena los chequeos DENTRO de cada día (Ascendente por hora)
    for (const day in dailyRecorrido) {
        dailyRecorrido[day].sort((a, b) => {
            const timeA = getDateSortValue(a.timestamp);
            const timeB = getDateSortValue(b.timestamp);
            return timeA - timeB; // Ascendente (A - B)
        });
    }

    return dailyRecorrido;
};


/**
 * Genera el nombre de la ubicación relevante para el timeline.
 */
const getDisplayLocation = (check, sheet) => {
    const locationName = check.patrullaNombre || 'Ubicación Desconocida';
    const movilDominio = check.movilDominio || '';

    // Lógica para la pestaña CONSOLIDADA (usa HojaOrigen)
    if (sheet === "Recorridos_Consolidados") {
        const sheetSource = check.HojaOrigen || 'N/A';

        const typeMap = {
             "Verificacion de Baterias/Patrullas": "B/P",
             "Verificacion de objetivos MAC": "MAC",
             "Verificacion de sitios Aysa": "AYSA",
             "verificacion de bases": "BASE",
        };

        const typeDisplay = typeMap[sheetSource] || sheetSource.replace('Verificacion de ', '').replace('verificacion de ', '');

        return `${locationName} (${typeDisplay})`;
    }

    // Lógica para las pestañas individuales
    return `${locationName} - ${movilDominio || 'Puesto Fijo'}`;
};

/**
 * Función que renderiza el HTML del recorrido para un día específico (Timeline).
 */
const renderRecorridoForDate = (dayISO, supervisorName, dailyRecorrido) => {
    if (!recorridoContainer) return;

    const checks = dailyRecorrido[dayISO];

    const availableDays = Object.keys(dailyRecorrido).sort().reverse();

    if (!checks || checks.length === 0) {
        let availableDaysHtml = availableDays.length > 0
            ? `<p><strong>Días con chequeos:</strong> ${availableDays.map(d => {
                     const dateParts = d.split('-'); // YYYY-MM-DD
                     return `${dateParts[2]}/${dateParts[1]}`; // DD/MM
                }).join(', ')}</p>`
            : `<p>Este supervisor no tiene chequeos registrados.</p>`;

        recorridoContainer.innerHTML = `<div class="card p-3 text-center">
                                             <h4>No hay chequeos registrados el ${new Date(dayISO).toLocaleDateString()}</h4>
                                             <p>Selecciona otra fecha o supervisor.</p>
                                             ${availableDaysHtml}
                                         </div>`;
        return;
    }

    let html = '';

    const dayCheck = checks[0].timestamp ? checks[0].timestamp.split(',')[0].trim() : new Date(dayISO).toLocaleDateString();

    html += `<div class="card recorrido-day-card">
                 <div class="card-header">Día: <strong>${dayCheck}</strong> (${checks.length} Chequeos)</div>
                 <ul class="list-group list-group-flush recorrido-timeline">`;

    checks.forEach((check) => {

        const timePart = check.timestamp ? check.timestamp.split(',')[1].trim() : 'N/A';
        const isAlert = hasAlert(check);
        // Usamos encodeURIComponent para serializar el objeto JSON de forma segura
        const checkDataString = JSON.stringify(check);

        const displayLocation = getDisplayLocation(check, "Recorridos_Consolidados");

        html += `
             <li class="list-group-item recorrido-item ${isAlert ? 'item-alert' : ''}">
                 <div class="item-time">${timePart}</div>
                 <div class="item-details">
                     <span class="item-location"><strong>${displayLocation}</strong></span>
                 </div>
                 <button class="button-small recorrido-btn-detail"
                     data-check='${encodeURIComponent(checkDataString)}'
                     title="Ver detalle del chequeo">
                     ${isAlert ? '🚨 Ver Detalle' : '✅ Ver Detalle'}
                 </button>
             </li>
         `;
    });

    html += `</ul></div>`;
    recorridoContainer.innerHTML = html;
};


window.showSupervisorRecorrido = (emailSupervisor) => {
    if (!recorridoContainer || !recorridoInstructions || !recorridoDateSelector || currentSheet !== "Recorridos_Consolidados") {
          return; // No hacer nada si no estamos en la pestaña correcta
    }

    // 1. Marcar el supervisor activo
    const allListItems = document.querySelectorAll('.supervisor-list li');
    allListItems.forEach(li => li.classList.remove('active-supervisor'));

    const clickedItem = document.querySelector(`.supervisor-list li[data-email="${emailSupervisor}"]`);
    if(clickedItem) clickedItem.classList.add('active-supervisor');

    activeSupervisorEmail = emailSupervisor;

    // 2. Filtrar y agrupar los datos
    const supervisorData = sheetData.filter(item =>
        item.emailSupervisor && item.emailSupervisor.trim().toLowerCase() === emailSupervisor.trim().toLowerCase()
    );

    const supervisorName = emailSupervisor.includes('@') ? emailSupervisor.split('@')[0] : emailSupervisor;

    if (supervisorData.length === 0) {
        recorridoContainer.innerHTML = `<p class="text-danger">No se encontraron chequeos para ${supervisorName}.</p>`;
        recorridoInstructions.innerHTML = `Ruta de Chequeos de: <strong>${supervisorName}</strong>`;
        return;
    }

    const dailyRecorrido = groupRecorridoByDay(supervisorData);

    // 3. Determinar y establecer la fecha más reciente
    const availableDates = Object.keys(dailyRecorrido).sort().reverse(); // YYYY-MM-DD
    const latestDateISO = availableDates[0] || recorridoDateSelector.value;

    recorridoDateSelector.value = latestDateISO;
    recorridoDateSelector.dataset.activeSupervisor = emailSupervisor;
    // Guardamos los datos agrupados en el dataset para accederlos desde el listener de cambio de fecha
    recorridoDateSelector.dataset.dailyRecorrido = JSON.stringify(dailyRecorrido);

    // 4. Renderizar el recorrido
    renderRecorridoForDate(latestDateISO, supervisorName, dailyRecorrido);

    recorridoInstructions.innerHTML = `Ruta de Chequeos de: <strong>${supervisorName}</strong>`;
    recorridoContainer.scrollIntoView({ behavior: 'smooth' });
};


// ====================================================================================================
// 5. RENDERIZADO Y BÚSQUEDA (Globales)
// (El código de `filterAndSearch`, `getDynamicHeaders`, `renderData`, `renderTable`, `renderCards` y `showDetailsModal` se mantiene igual)
// ====================================================================================================

window.filterAndSearch = () => {
    let filteredData = [...sheetData];

    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const alertValue = alertFilter ? alertFilter.value : '';

    if (alertValue === 'alerts') {
        filteredData = filteredData.filter(item => hasAlert(item) || item.inactividadAlerta);
    }

    if (searchTerm) {
        filteredData = filteredData.filter(item => {

            const supervisorMatch = item.emailSupervisor && item.emailSupervisor.toLowerCase().includes(searchTerm);
            const generalMatch = (item.timestamp && item.timestamp.toLowerCase().includes(searchTerm));

            const puestoMatch = item.patrullaNombre && item.patrullaNombre.toLowerCase().includes(searchTerm);

            const movilMatch = item.movilDominio && item.movilDominio.toLowerCase().includes(searchTerm);

            const vigiladorMatch = item.vigiladores && item.vigiladores.some(v =>
                (v.nombre && v.nombre.toLowerCase().includes(searchTerm)) ||
                (v.legajo && v.legajo.includes(searchTerm)) ||
                (v.capacitacion && v.capacitacion.toLowerCase().includes(searchTerm))
            );

            return generalMatch || puestoMatch || movilMatch || vigiladorMatch || supervisorMatch;
        });
    }

    window.renderData(filteredData);
};

const getDynamicHeaders = () => {
    let principalHeader = '';

    switch (currentSheet) {
        case "Verificacion de objetivos MAC":
            principalHeader = 'Objetivo';
            break;
        case "Verificacion de sitios Aysa":
            principalHeader = 'Sitio';
            break;
        case "verificacion de bases":
            principalHeader = 'Base';
            break;
        case "Verificacion de Baterias/Patrullas":
        default:
            principalHeader = 'Patrulla/Batería';
            break;
    }

    const headers = [
        '🚨',
        principalHeader,
        'Móvil/Tipo',
        'Supervisor',
        'Fecha Chequeo',
        // Oculta Combustible/Km para MAC, AYSA y BASES
        ...((currentSheet === "Verificacion de objetivos MAC" || currentSheet === "verificacion de bases" || currentSheet === "Verificacion de sitios Aysa") ? [''] : ['Combustible', 'Km']),
        'Vigiladores (U/R)',
        'Detalles'
    ];

    return headers.filter(h => h.trim() !== '');
};

window.renderData = (dataToRender) => {
    if (!dataContainer) {
          return;
    }

    dataContainer.innerHTML = '';

    if (countDisplay) countDisplay.textContent = dataToRender.length;
    if (resultsTitle) resultsTitle.textContent = `Resultados del Chequeo (${dataToRender.length})`;

    // Usa el ancho de la ventana para decidir entre tabla y tarjetas (Responsiveness)
    if (window.innerWidth > 900) {
        window.renderTable(dataToRender);
    } else {
        window.renderCards(dataToRender);
    }
};

window.renderTable = (dataToRender) => {
    if (!dataContainer) return;
    const headers = getDynamicHeaders();
    const isMovilCheck = currentSheet !== "Verificacion de objetivos MAC" && currentSheet !== "Verificacion de sitios Aysa";
    const isBaseCheck = currentSheet === "verificacion de bases";

    let tableHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    ${headers.map(h => `<th>${h}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
    `;

    dataToRender.forEach((item, index) => {
        const isAlert = hasAlert(item);
        const isInactivityAlert = item.inactividadAlerta;

        let alertClass = '';
        if (isInactivityAlert) {
            alertClass = 'inactivity-alert-row';
        } else if (isAlert) {
            alertClass = 'alert-row';
        }

        const statusIcon = isInactivityAlert ? '🛑' : (isAlert ? '🚨' : '✅');

        let vigiladoresSummary = 'N/A';
        if (item.vigiladores && item.vigiladores.length > 0) {
             vigiladoresSummary = item.vigiladores.map(v => {
                 const namePart = (v.nombre && typeof v.nombre === 'string') ? v.nombre.split(' ')[0] : 'Vigilador';
                 const regStatus = (v.regControlado && v.regControlado.length > 0) ? v.regControlado.substring(0,1) : '?';
                 const uniStatus = (v.uniformeCompleto && v.uniformeCompleto.length > 0) ? v.uniformeCompleto.substring(0,1) : '?';
                 return `${namePart} (${uniStatus}/${regStatus})`;
             }).join('<br>');
        }

        const combustibleDisplay = item.combustibleFraccion || 'N/A';
        const combustibleAlertClass = isMovilCheck && !isBaseCheck && item.combustibleFraccion && checkCombustible(item.combustibleFraccion).alerta ? 'text-danger' : '';

        const supervisorDisplay = (item.emailSupervisor && typeof item.emailSupervisor === 'string') ? item.emailSupervisor.split('@')[0] : 'N/A';

        const showMovilDetails = isMovilCheck && !isBaseCheck;

        // ⚠️ CRÍTICO: Usamos encodeURIComponent en la tabla para asegurar que los datos pasen correctamente al modal
        const itemDataString = JSON.stringify(item);

        tableHTML += `
            <tr class="${alertClass}" data-index="${index}">
                <td>${statusIcon}</td>
                <td>${item.patrullaNombre || 'N/A'}</td>
                <td>${item.movilDominio || (isBaseCheck ? 'Base Fija' : 'Puesto Fijo')}</td>
                <td>${supervisorDisplay}</td>
                <td>${item.timestamp ? item.timestamp.split(',')[0] : 'N/A'}</td>
                ${showMovilDetails ? `<td class="${combustibleAlertClass}">${combustibleDisplay}</td>` : ''}
                ${showMovilDetails ? `<td>${item.kilometraje || 'N/A'}</td>` : ''}
                <td>${vigiladoresSummary}</td>
                <td>
                    <button class="view-details-btn button-small"
                            onclick="event.stopPropagation(); window.showDetailsModal(JSON.parse(decodeURIComponent('${encodeURIComponent(itemDataString)}')))">
                        Ver Detalle
                    </button>
                </td>
            </tr>
        `;
    });

    tableHTML += `</tbody></table>`;
    dataContainer.innerHTML = tableHTML;
};

window.renderCards = (dataToRender) => {
    if (!dataContainer) return;
    let cardsHTML = `<div class="card-grid">`;

    dataToRender.forEach((item, index) => {
        const isAlert = hasAlert(item);
        const isInactivityAlert = item.inactividadAlerta;
        const isRecorridoCheck = currentSheet === "Recorridos_Consolidados";
        // Si es Recorrido, revisamos HojaOrigen
        const isBaseCheck = isRecorridoCheck ? (item.HojaOrigen === "verificacion de bases") : (currentSheet === "verificacion de bases");
        const isMovilCheck = isRecorridoCheck ? (item.HojaOrigen !== "Verificacion de objetivos MAC" && item.HojaOrigen !== "Verificacion de sitios Aysa") : (currentSheet !== "Verificacion de objetivos MAC" && currentSheet !== "Verificacion de sitios Aysa");

        let cardClass = '';
        let alertIconText = '✅ OK';

        if (isInactivityAlert) {
            cardClass = 'inactivity-alert-card';
            alertIconText = '🛑 INACTIVIDAD';
        } else if (isAlert) {
            cardClass = 'alert-card';
            alertIconText = '🚨 ALERTA';
        }

        const supervisorDisplay = (item.emailSupervisor && typeof item.emailSupervisor === 'string') ? item.emailSupervisor.split('@')[0] : 'N/A';

        let vigiladoresSummary = '';
        if (item.vigiladores && item.vigiladores.length > 0) {
            vigiladoresSummary = item.vigiladores.map(v => {
                const namePart = (v.nombre && typeof v.nombre === 'string') ? v.nombre.split(' ')[0] : 'Vigilador';
                const regStatus = (v.regControlado && v.regControlado.length > 0) ? v.regControlado.substring(0,1) : '?';
                const uniStatus = (v.uniformeCompleto && v.uniformeCompleto.length > 0) ? v.uniformeCompleto.substring(0,1) : '?';
                return `<li>${namePart} (U:${uniStatus}/R:${regStatus})</li>`;
            }).join('');
        } else {
            vigiladoresSummary = '<li>Sin Vigiladores Chequeados</li>';
        }

        const combustibleDisplay = item.combustibleFraccion || 'N/A';

        // ⚠️ CRÍTICO: Usamos encodeURIComponent en la tarjeta para asegurar que los datos pasen correctamente al modal
        const itemDataString = JSON.stringify(item);

        cardsHTML += `
            <div class="data-card ${cardClass}" data-index="${index}">
                <div class="card-header">
                    <h4>${item.patrullaNombre || 'N/A'} - ${item.movilDominio || (isBaseCheck ? 'Base Fija' : 'Puesto Fijo')}</h4>
                    <span class="status-icon">${alertIconText}</span>
                </div>
                <p><strong>Fecha:</strong> ${item.timestamp ? item.timestamp.split(',')[0] : 'N/A'}</p>
                <p><strong>Supervisor:</strong> ${supervisorDisplay}</p>
                ${isMovilCheck && !isBaseCheck ? `<p><strong>Combustible:</strong> ${combustibleDisplay}</p>` : ''}
                <p><strong>Vigiladores:</strong> <ul>${vigiladoresSummary}</ul></p>
                <button class="view-details-btn button-full"
                        onclick="event.stopPropagation(); window.showDetailsModal(JSON.parse(decodeURIComponent('${encodeURIComponent(itemDataString)}')))">
                    Ver Detalles Completos
                </button>
            </div>
        `;
    });

    cardsHTML += `</div>`;
    dataContainer.innerHTML = cardsHTML;
};

// Hacemos la función global para que el Event Listener Delegado pueda encontrarla.
window.showDetailsModal = (item) => {
    // Lógica para determinar el tipo de chequeo basada en la hoja actual o la hoja de origen
    const isRecorridoCheck = currentSheet === "Recorridos_Consolidados";
    const sheetType = isRecorridoCheck ? (item.HojaOrigen || currentSheet) : currentSheet;

    const isBaseCheck = sheetType === "verificacion de bases";
    const isMovilCheck = sheetType !== "Verificacion de objetivos MAC" && sheetType !== "Verificacion de sitios Aysa" && !isBaseCheck;

    let basesFaltas = [];

    const getColorClass = (value) => {
        if (!value) return '';
        const lowerValue = value.toString().toLowerCase().trim();

        if (lowerValue === 'no' || lowerValue === 'regular' || lowerValue === 'mala') {
            return 'text-danger';
        }

        if (lowerValue === 'si' || lowerValue === 'sí' || lowerValue === 'buena') {
            return 'text-success';
        }
        return '';
    };

    const isNegativeValue = (value) => {
        if (!value) return false;
        const lowerValue = value.toString().toLowerCase();
        return lowerValue === 'no' || lowerValue === 'regular' || lowerValue === 'mala';
    };

    // 1. Detalles Generales
    let html = `
        <p><strong>Puesto/Base/Sitio:</strong> ${item.patrullaNombre || 'N/A'}</p>
        <p><strong>Supervisor:</strong> ${(item.emailSupervisor && typeof item.emailSupervisor === 'string' ? item.emailSupervisor : 'N/A')}</p>
        <p><strong>Fecha/Hora Chequeo:</strong> ${item.timestamp || 'N/A'}</p>
        ${isRecorridoCheck ? `<p><strong>Origen del Chequeo:</strong> ${item.HojaOrigen ? item.HojaOrigen.replace('Verificacion de ', '').replace('verificacion de ', '') : 'N/A'}</p>` : ''}
        <hr>
    `;

    // 2. Detalles Específicos de Móvil/Batería/Patrulla/Base
    if (isBaseCheck) {
        basesFaltas = getBasesAlertDetails(item);

        if (basesFaltas.length > 0) {
            html += `<h4 class="text-danger">🚨 Faltas en la Base:</h4>
                     <ul>`;
            basesFaltas.forEach(falta => {
                html += `<li><strong class="text-danger">${falta}</strong></li>`;
            });
            html += `</ul><hr>`;
        } else {
            html += `<p class="text-success">✅ Todos los chequeos básicos de la Base están **OK**.</p><hr>`;
        }

        const baseDetailFields = [
            { label: "Dominio/Móvil", key: "movilDominio", checkAlert: false },
            { label: "Kilometraje", key: "kilometraje", checkAlert: false },
            { label: "Nivel de Combustible", key: "combustibleFraccion", checkAlert: false },
            { label: "Higiene de la Base", key: "higieneMovil", checkAlert: true },
            { label: "Posee Botiquín", key: "poseeBotiquin", checkAlert: true },
            { label: "Posee Auxilio", key: "poseeAuxilio", checkAlert: true },
            { label: "Posee Matafuegos en vigencia", key: "poseeMatafuegos", checkAlert: true },
            { label: "Posee Baliza", key: "poseeBaliza", checkAlert: true },
            { label: "Posee Linterna", key: "poseeLinterna", checkAlert: true },
            { label: "Posee Cable para puentear bateria", key: "poseeCableBateria", checkAlert: true },
            { label: "Posee Capa de lluvia", key: "poseeCapaLluvia", checkAlert: true },
            { label: "Posee toda la documentacion del movil", key: "poseeDocumentacionMovil", checkAlert: true },
            { label: "Posee Linga", key: "poseeLinga", checkAlert: true },
            { label: "Posee Cricket", key: "poseeCricket", checkAlert: true },
            { label: "Posee Llave Cruz", key: "poseeLlaveCruz", checkAlert: true },
        ];

        let baseDetailsHtml = `<h4>Información del Chequeo:</h4>`;
        let hasBaseInfo = false;

        baseDetailFields.forEach(field => {
             const value = item[field.key];

             if (value && value.toString().trim().toUpperCase() !== 'N/A') {
                 const colorClass = field.checkAlert ? getColorClass(value) : '';

                 baseDetailsHtml += `<p class="${colorClass}"><strong>${field.label}:</strong> ${value}</p>`;
                 hasBaseInfo = true;
             }
        });

        if (hasBaseInfo) {
            html += baseDetailsHtml;
        }

    } else if (isMovilCheck) { // Baterías/Patrullas
        html += `
             <h4>Información del Móvil/Puesto:</h4>
             <p><strong>Dominio/Móvil:</strong> ${item.movilDominio || 'N/A'}</p>
             <p><strong>Kilometraje:</strong> ${item.kilometraje || 'N/A'}</p>
             <p class="${item.combustibleFraccion && checkCombustible(item.combustibleFraccion).alerta ? 'text-danger' : ''}"><strong>Nivel de Combustible:</strong> ${item.combustibleFraccion || 'N/A'}</p>
             <p class="${getColorClass(item.higieneMovil)}"><strong>Higiene:</strong> ${item.higieneMovil || 'N/A'}</p>
             <p class="${getColorClass(item.poseeBotiquin)}"><strong>Posee Botiquín:</strong> ${item.poseeBotiquin || 'N/A'}</p>
        `;
    } else { // Objetivos MAC o Sitios AYSA (Puesto Fijo/Sitio)
        html += `<h4>Información del Puesto:</h4><p>Dominio/Móvil: N/A - Puesto Fijo</p>`;
    }

    // 3. Observaciones Generales
    if (item.observacionesMovil) {
        html += `<hr><p><strong>Observaciones Generales:</strong> ${item.observacionesMovil || 'Sin observaciones'}</p>`;
    }

    html += '<hr>';

    // 4. Listar vigiladores
    if (item.vigiladores && item.vigiladores.length > 0) {
        html += `<h4>Vigiladores Chequeados:</h4>`;
        item.vigiladores.forEach((v, i) => {
            const isUniformeAlert = isNegativeValue(v.uniformeCompleto);
            const isRegAlert = isNegativeValue(v.regControlado);
            const isCapacitacionAlert = isNegativeValue(v.capacitacion);

            const faltas = [];
            if (isRegAlert) faltas.push('Falta Registro');
            if (isUniformeAlert) faltas.push('Falta Uniforme');
            if (isCapacitacionAlert) faltas.push('Falta Capacitación');

            const isVigiladorAlert = isRegAlert || isUniformeAlert; // Solo estas dos causan el ícono 🚨

            const statusDisplay = isVigiladorAlert
                ? `<span class="text-danger">🚨 **Falta Grave:** ${faltas.filter(f => f !== 'Falta Capacitación').join(', ')}</span>`
                : `<span class="${isCapacitacionAlert ? 'text-warning' : 'text-success'}">${isCapacitacionAlert ? '⚠️ Capacitación Pendiente' : '✅ OK'}</span>`;

            html += `<div class="vigilador-detail">
                <h5>Vigilador ${i + 1} (${v.legajo || 'N/A'}) - ${v.nombre || 'N/A'}</h5>
                <p><strong>Estado:</strong> ${statusDisplay}</p>

                <p class="${getColorClass(v.regControlado)}"><strong>Registro Controlado / Presentación:</strong> ${v.regControlado || 'N/A'}</p>
                <p class="${getColorClass(v.uniformeCompleto)}"><strong>Uniforme Completo:</strong> ${v.uniformeCompleto || 'N/A'}</p>

                <p class="${getColorClass(v.capacitacion)}"><strong>Capacitación Realizada:</strong> ${v.capacitacion || 'N/A'}</p>

                <p><strong>Observaciones:</strong> ${v.observaciones || 'N/A'}</p>
            </div>`;
        });
    } else {
        html += `<p>No se registraron vigiladores para este chequeo.</p>`;
    }

    if (modalBody) modalBody.innerHTML = html;
    if (detailsModal) detailsModal.style.display = 'block';
};

// Event listeners para el modal
if (closeModal) {
    closeModal.onclick = () => { if (detailsModal) detailsModal.style.display = 'none'; };
};

if (detailsModal) {
    window.onclick = (event) => {
        if (event.target == detailsModal) {
            detailsModal.style.display = 'none';
        }
    };
}


// ====================================================================================================
// 6. INICIALIZACIÓN
// ====================================================================================================

/**
 * Usa delegación de eventos para manejar clics en botones de detalle
 * dentro del contenedor de recorrido (#recorridoContainer).
 */
const setupRecorridoDetailListener = () => {
    if (!recorridoContainer) return;

    recorridoContainer.addEventListener('click', (event) => {
        // Busca el botón .button-small más cercano al elemento clickeado
        const button = event.target.closest('.button-small');

        if (button && button.hasAttribute('data-check')) { // Verificamos que sea el botón de detalle del recorrido
            event.stopPropagation();

            // Obtenemos el string JSON codificado
            const checkDataString = button.dataset.check;

            try {
                // Decodificamos y Parseamos el string JSON a un objeto JavaScript
                const itemData = JSON.parse(decodeURIComponent(checkDataString));

                // Llamamos a la función showDetailsModal con el objeto completo
                window.showDetailsModal(itemData);
            } catch (e) {
                console.error("Error al parsear datos del recorrido:", e);
                alert("No se pudo cargar el detalle del chequeo. Verifique el formato JSON.");
            }
        }
    });
};

const initialize = () => {
    // ⚠️ CRÍTICO: OCULTAR LA SECCIÓN DE RECORRIDO/SUMARIO AL INICIO
    // Esto evita que se vea un "flash" de contenido irrelevante antes de que loadData decida qué mostrar.
    console.log("APP INIT: Verificando estado inicial de summary-section.");
    if (summarySection) {
        // 1. Ocultar el contenedor padre (esto oculta a los hijos: análisis, sumario, recorrido)
        summarySection.style.display = 'none'; 
        console.log(`INIT STATUS: summarySection visibility set to: ${summarySection.style.display}`);
    } else {
        console.error("ERROR: No se encontró el elemento .summary-section.");
    }

    // 2. Ocultar el contenedor de Análisis de Repeticiones. 
    // Aunque el padre lo oculta, mantenemos esta línea para asegurar que si el padre se muestra por error, el análisis (que solo es visible después de cargar el supervisor) permanezca oculto.
    if (repetitionAnalysisContainer) {
        repetitionAnalysisContainer.style.display = 'none';
    }

    if (searchInput) searchInput.addEventListener('input', window.filterAndSearch);
    if (alertFilter) alertFilter.addEventListener('change', window.filterAndSearch);

    // Aseguramos que el redimensionamiento también use la función global
    window.addEventListener('resize', () => {
        // Solo renderiza la tabla/tarjeta si NO estamos en la pestaña de recorrido
        if (sheetData.length > 0 && currentSheet !== "Recorridos_Consolidados") {
             window.renderData(sheetData);
        }
    });

    tabButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const sheetName = event.target.dataset.sheet;
            tabButtons.forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            loadData(sheetName);
        });
    });

    // Configurar el selector de fecha y su listener
    if (recorridoDateSelector) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayISO = `${year}-${month}-${day}`;

        recorridoDateSelector.value = todayISO;

        recorridoDateSelector.addEventListener('change', (event) => {
            const selectedDate = event.target.value;
            const activeSupervisor = event.target.dataset.activeSupervisor;
            const rawDailyRecorrido = event.target.dataset.dailyRecorrido;

            if (activeSupervisor && rawDailyRecorrido) {
                // Recuperamos los datos agrupados que se guardaron al hacer clic en el supervisor
                const dailyRecorrido = JSON.parse(rawDailyRecorrido);
                const supervisorName = activeSupervisor.includes('@') ? activeSupervisor.split('@')[0] : activeSupervisor;

                renderRecorridoForDate(selectedDate, supervisorName, dailyRecorrido);
            }
        });
    }

    // 🎯 Configurar el listener delegado para los botones "Ver Detalle" del recorrido
    setupRecorridoDetailListener();


    // Carga Inicial
    const initialTab = document.querySelector(`.tab-button[data-sheet="${currentSheet}"]`);
    if (initialTab) {
        initialTab.classList.add('active');
    }

    loadData(currentSheet);
};

window.onload = initialize;