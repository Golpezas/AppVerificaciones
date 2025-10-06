// ====================================================================================================
// 1. DATA Y CONFIGURACIÓN CRÍTICA
// ====================================================================================================

// 🛑 ¡PUNTO CRÍTICO! REEMPLAZA ESTA URL CON LA DE TU PROPIO DESPLIEGUE. 
const API_URL = 'https://script.google.com/macros/s/AKfycbzDjq01yI157yqVUnRddgOrZS0Y7i2Vsdq23CD39lqoF6cHTNDiFYerxYRqXo2vE2Uysw/exec'; 

let currentSheet = "Verificacion de Baterias/Patrullas"; 
let sheetData = []; 

// Referencias del DOM
const dataContainer = document.getElementById('dataContainer');
const searchInput = document.getElementById('searchInput');
const alertFilter = document.getElementById('alertFilter');
const countDisplay = document.getElementById('countDisplay');
const detailsModal = document.getElementById('detailsModal');
const modalBody = document.getElementById('modalBody');
const closeModal = document.querySelector('.close-button');
const tabButtons = document.querySelectorAll('.tab-button');

// Referencias del DOM para el SUMARIO y RECORRIDO
const supervisorSummary = document.getElementById('supervisorSummary');
const recorridoContainer = document.getElementById('recorridoContainer');
const recorridoInstructions = document.getElementById('recorridoInstructions');
const resultsTitle = document.getElementById('resultsTitle'); 
const recorridoDateSelector = document.getElementById('recorridoDateSelector');


// ====================================================================================================
// 2. FUNCIONES DE CARGA Y ORDENAMIENTO (Corregidas para la hora local)
// ====================================================================================================

/**
 * Función auxiliar para obtener un valor numérico (milisegundos) comparable basado en la fecha y hora.
 * CRÍTICO: Utiliza el constructor local para mitigar el problema de desfase de zona horaria.
 */
const getDateSortValue = (timestampString) => {
    if (!timestampString) return 0;

    // Formato: "DD/MM/AAAA, HH:MM:SS p.m."
    
    const [datePartWithSpaces, timePartWithSpaces] = timestampString.split(', ');
    
    let datePart = datePartWithSpaces ? datePartWithSpaces.trim() : null;
    let timePart = timePartWithSpaces ? timePartWithSpaces.trim() : null;
    
    if (!datePart || !timePart) {
         // Intenta el formato sin coma si falla el primero
         const parts = timestampString.trim().split(' ');
         if (parts.length >= 2) {
             timePart = parts.pop();
             datePart = parts.join(' ');
         } else {
             return 0;
         }
    }
    
    // 1. Obtener partes de la fecha (DD, MM, AAAA)
    const dateParts = datePart.split('/');
    if (dateParts.length !== 3) return 0;

    const day = parseInt(dateParts[0]);
    const monthIndex = parseInt(dateParts[1]) - 1; // 0-indexado (Enero = 0)
    const year = parseInt(dateParts[2]);

    // 2. Obtener partes de la hora y convertir a 24 horas (HH, MM, SS)
    const timeElements = timePart.split(' ');
    const hms = timeElements[0];
    const ampm = timeElements.length > 1 ? timeElements[1] : '';

    const [rawHour, minute, second] = hms.split(':').map(n => parseInt(n));
    if (isNaN(rawHour) || isNaN(minute) || isNaN(second)) return 0;
    
    let hour = rawHour;

    // Conversión a formato 24 horas
    if (ampm && ampm.toLowerCase() === 'p.m.' && hour !== 12) {
        hour += 12;
    } else if (ampm && ampm.toLowerCase() === 'a.m.' && hour === 12) {
        hour = 0; // Medianoche (12:xx:xx a.m.)
    }
    
    // Construcción: Usamos el constructor local (Year, MonthIndex, Day, Hour, Minute, Second)
    const dateObj = new Date(year, monthIndex, day, hour, minute, second);

    // Devolvemos el valor numérico (milisegundos) para la comparación
    return isNaN(dateObj.getTime()) ? 0 : dateObj.getTime();
};


const loadData = async (sheetName) => {
    currentSheet = sheetName;
    
    // 1. Limpieza y mensajes de carga
    if (dataContainer) {
        dataContainer.innerHTML = `<p class="loading-message">Cargando datos de **${sheetName}**, por favor espere...</p>`;
    }
    if (supervisorSummary) {
        supervisorSummary.innerHTML = '<p>Cargando sumario...</p>';
    }
    // Restablecer el recorrido
    if (recorridoContainer && recorridoInstructions) {
        recorridoContainer.innerHTML = ''; 
        recorridoInstructions.textContent = 'Selecciona un supervisor del sumario para ver su recorrido.';
    }
    
    const fullUrl = `${API_URL}?sheet=${encodeURIComponent(sheetName)}`;

    try {
        // 2. Obtener datos
        const response = await fetch(fullUrl);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }
        
        sheetData = data; 
        
        // 🚀 CRÍTICO: Ordenamiento DESCENDENTE (Más Reciente a Más Antiguo)
        sheetData.sort((a, b) => {
            const sortValueA = getDateSortValue(a.timestamp); 
            const sortValueB = getDateSortValue(b.timestamp);
            return sortValueB - sortValueA; // B - A para DESCENDENTE
        });

        // 4. Actualizar UI
        sheetData = checkInactivity(sheetData); 
        updateSummaryData(sheetData); 
        window.filterAndSearch(); // Muestra la tabla principal (ya ordenada) o aplica filtros
        
    } catch (error) {
        console.error("Fallo al obtener los datos:", error);
        if (dataContainer) {
             dataContainer.innerHTML = `<p class="text-danger">❌ **Error de Conexión/Datos:** Verifique la URL de la API y el formato de los datos. Error: ${error.message}</p>`;
        }
        if (countDisplay) countDisplay.textContent = 0;
        if (supervisorSummary) supervisorSummary.innerHTML = `<p class="text-danger">Error: No se pudo cargar el sumario.</p>`;
    }
};

// ====================================================================================================
// 3. LÓGICA DE NEGOCIO Y ALERTAS (hasAlert Corregida para capacitación)
// ====================================================================================================

const checkCombustible = (fraccion) => {
    if (fraccion === 'N/A' || !fraccion) return { valor: 100, alerta: false };
    const parts = fraccion.split('/');
    if (parts.length !== 2) return { valor: 100, alerta: false };
    
    const [num, den] = parts.map(n => parseInt(n.trim()));
    if (den === 0 || isNaN(num) || isNaN(den)) return { valor: 100, alerta: false };

    const valor = (num / den) * 100;
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
    const checkMovil = currentSheet !== "Verificacion de objetivos MAC";
    const isBaseCheck = currentSheet === "verificacion de bases";

    if (isBaseCheck) {
        return getBasesAlertDetails(item).length > 0;
    }

    if (checkMovil && item.combustibleFraccion && checkCombustible(item.combustibleFraccion).alerta) {
        return true;
    }
    
    if (checkMovil) {
        if (isNegative(item.poseeBotiquin)) return true;
        if (isNegative(item.higieneMovil)) return true;
    }
    
    if (item.vigiladores && item.vigiladores.length > 0) {
        const vigiladorAlerta = item.vigiladores.some(v => 
            // 🚨 CORRECCIÓN: La capacitación NO genera la alerta principal.
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
        
        item.inactividadAlerta = isLatestReport && hasPassedThreshold;
        
        return item;
    });
};

const updateSummaryData = (data) => {
    const supervisorCounts = {};
    
    data.filter(item => item.emailSupervisor).forEach(item => {
        const key = item.emailSupervisor.trim().toLowerCase(); 
        supervisorCounts[key] = (supervisorCounts[key] || 0) + 1;
    });

    let html = '<h4>Supervisores y Cantidad de Informes:</h4><ul class="supervisor-list">';
    const sortedSupervisors = Object.entries(supervisorCounts).sort(([, a], [, b]) => b - a);

    if (sortedSupervisors.length > 0) {
        sortedSupervisors.forEach(([supervisorEmail, count]) => {
            const displaySupervisor = supervisorEmail.includes('@') ? supervisorEmail.split('@')[0] : supervisorEmail; 
            
            html += `<li onclick="window.showSupervisorRecorrido('${supervisorEmail}')" data-email="${supervisorEmail}">
                        <span class="supervisor-name">${displaySupervisor}</span>: 
                        <span class="report-count">${count} chequeos</span>
                     </li>`;
        });
    } else {
        html = '<p>No hay registros válidos de supervisores en esta hoja.</p>';
    }
    
    html += '</ul>';
    if(supervisorSummary) supervisorSummary.innerHTML = html;
};


// ====================================================================================================
// 4. LÓGICA DE RECORRIDO Y FILTRO DE FECHA (groupRecorridoByDay Corregido para la hora local)
// ====================================================================================================

/**
 * Agrupa las verificaciones de un supervisor por día y asegura el orden cronológico.
 * CORREGIDO: Usa métodos locales para evitar el desfase de zona horaria al crear la clave del día.
 */
const groupRecorridoByDay = (data) => {
    const dailyRecorrido = {};

    data.forEach(item => {
        const sortValue = getDateSortValue(item.timestamp);
        if (sortValue === 0) return;

        const dateObj = new Date(sortValue); 
        
        // 🚨 CRÍTICO: Usamos métodos locales para generar la clave YYYY-MM-DD
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        
        const dayKey = `${year}-${month}-${day}`; // Clave YYYY-MM-DD

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
 * Genera el nombre de la ubicación relevante según la pestaña activa.
 */
const getDisplayLocation = (check, currentSheet) => {
    const locationName = check.patrullaNombre || 'Ubicación Desconocida';
    const movilDominio = check.movilDominio || '';
    
    switch (currentSheet) {
        
        case "Verificacion de Baterias/Patrullas":
            if (movilDominio && movilDominio.trim().toUpperCase() !== 'N/A' && locationName !== 'Ubicación Desconocida') {
                 return `${movilDominio} - ${locationName}`;
            }
            return locationName;
            
        case "Verificacion de objetivos MAC":
        case "Verificacion de sitios Aysa": 
            return locationName; 

        case "verificacion de bases":
             return `${locationName} - Base Fija`;
             
        default:
             return `${locationName} ${movilDominio ? '- ' + movilDominio : ''}`;
    }
};

/**
 * Función que renderiza el HTML del recorrido para un día específico.
 * Nota: El objeto 'check' se pasa al modal via JSON encoding/decoding.
 */
const renderRecorridoForDate = (dayISO, supervisorName, dailyRecorrido) => {
    if (!recorridoContainer) return;
    
    const checks = dailyRecorrido[dayISO]; 
    
    const availableDays = Object.keys(dailyRecorrido).sort().reverse(); 

    if (!checks || checks.length === 0) {
        let availableDaysHtml = availableDays.length > 0 
            ? `<p><strong>Días con chequeos:</strong> ${availableDays.map(d => {
                 const dateParts = d.split('-'); 
                 return `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`; 
              }).join(', ')}</p>`
            : `<p>Este supervisor no tiene chequeos registrados.</p>`;
            
        recorridoContainer.innerHTML = `<div class="card p-3 text-center">
                                            <h4>No hay chequeos registrados el ${dayISO}</h4>
                                            <p>Selecciona otra fecha o supervisor.</p>
                                            ${availableDaysHtml}
                                        </div>`;
        return;
    }

    let html = '';
    
    const dayCheck = checks[0].timestamp ? checks[0].timestamp.split(',')[0].trim() : dayISO; 
    
    html += `<div class="card recorrido-day-card">
                <div class="card-header">Día: <strong>${dayCheck}</strong> (${checks.length} Chequeos)</div>
                <ul class="list-group list-group-flush">`;

    checks.forEach((check) => {
        
        const timePart = check.timestamp ? check.timestamp.split(',')[1].trim() : 'N/A'; 
        const isAlert = hasAlert(check); 
        const checkDataString = JSON.stringify(check); 
        
        const displayLocation = getDisplayLocation(check, currentSheet);

        html += `
            <li class="list-group-item recorrido-item ${isAlert ? 'item-alert' : ''}">
                <span class="item-time">[${timePart}]</span> 
                <span class="item-location"><strong>${displayLocation}</strong></span>
                <button class="btn-detail" 
                        onclick="event.stopPropagation(); showDetailsModal(JSON.parse(decodeURIComponent('${encodeURIComponent(checkDataString)}')))">
                    ${isAlert ? '🚨 Detalle' : '✅ Detalle'}
                </button>
            </li>
        `;
    });

    html += `</ul></div>`;
    recorridoContainer.innerHTML = html;
};


window.showSupervisorRecorrido = (emailSupervisor) => {
    if (!recorridoContainer || !recorridoInstructions || !recorridoDateSelector) {
         console.warn("Error: Elementos del DOM no definidos para el recorrido.");
         return;
    }
    
    const allListItems = document.querySelectorAll('.supervisor-list li');
    allListItems.forEach(li => li.classList.remove('active-supervisor'));
    
    const clickedItem = document.querySelector(`.supervisor-list li[data-email="${emailSupervisor}"]`);
    if(clickedItem) clickedItem.classList.add('active-supervisor');

    recorridoDateSelector.dataset.activeSupervisor = emailSupervisor;

    const supervisorData = sheetData.filter(item => 
        item.emailSupervisor && item.emailSupervisor.trim().toLowerCase() === emailSupervisor.trim().toLowerCase()
    );
    
    const supervisorName = emailSupervisor.includes('@') ? emailSupervisor.split('@')[0] : emailSupervisor;

    if (supervisorData.length === 0) {
        recorridoContainer.innerHTML = `<p class="text-danger">No se encontraron chequeos para ${supervisorName}.</p>`;
        recorridoInstructions.innerHTML = `<p>Recorrido detallado para: <strong>${supervisorName}</strong></p>`;
        return;
    }

    const dailyRecorrido = groupRecorridoByDay(supervisorData); 

    recorridoDateSelector.dataset.dailyRecorrido = JSON.stringify(dailyRecorrido);

    const selectedDateISO = recorridoDateSelector.value; 
    
    renderRecorridoForDate(selectedDateISO, supervisorName, dailyRecorrido);

    recorridoInstructions.innerHTML = `<p>Recorrido detallado para: <strong>${supervisorName}</strong></p>`;
    recorridoContainer.scrollIntoView({ behavior: 'smooth' });
};


// ====================================================================================================
// 5. RENDERIZADO Y BÚSQUEDA (CORRECCIÓN CRÍTICA DE ÁMBITO Y ACCESO A DATA)
// ====================================================================================================

window.filterAndSearch = () => {
    // 🚨 Usar una copia de los datos globales YA ordenados para empezar a filtrar
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

            const puestoMatch = item.patrullaNombre.toLowerCase().includes(searchTerm);

            const movilMatch = item.movilDominio && item.movilDominio.toLowerCase().includes(searchTerm);
                                        
            const vigiladorMatch = item.vigiladores && item.vigiladores.some(v => 
                (v.nombre && v.nombre.toLowerCase().includes(searchTerm)) || 
                (v.legajo && v.legajo.includes(searchTerm)) ||
                (v.capacitacion && v.capacitacion.toLowerCase().includes(searchTerm)) 
            );
            
            return generalMatch || puestoMatch || movilMatch || vigiladorMatch || supervisorMatch;
        });
    }
    
    // 🚨 Llamada corregida a la función global
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
        ...((currentSheet === "Verificacion de objetivos MAC" || currentSheet === "verificacion de bases" || currentSheet === "Verificacion de sitios Aysa") ? [''] : ['Combustible', 'Km']), 
        'Vigiladores (U/R)', 
        'Detalles'
    ];
    
    return headers.filter(h => h.trim() !== '');
};

// 🚨 CORRECCIÓN DE ÁMBITO: renderData ahora es global (window.)
window.renderData = (dataToRender) => {
    if (!dataContainer) {
         console.warn("Error: dataContainer no está definido.");
         return;
    }

    dataContainer.innerHTML = '';
    
    if (countDisplay) countDisplay.textContent = dataToRender.length;
    if (resultsTitle) resultsTitle.textContent = `Resultados del Chequeo (${dataToRender.length})`;

    // Las llamadas a renderTable/renderCards no necesitan 'window.' si son declaradas antes, 
    // pero para seguridad total las hacemos globales también.
    if (window.innerWidth > 900) {
        window.renderTable(dataToRender);
    } else {
        window.renderCards(dataToRender);
    }
};

// 🚨 CORRECCIÓN DE ÁMBITO: renderTable ahora es global (window.)
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
            alertClass = 'inactivity-alert-row'; // 🛑 (Alerta de Inactividad 24h)
        } else if (isAlert) {
            alertClass = 'alert-row'; // 🚨 (Alerta de Chequeo/Fallas)
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

        // 🚨 CÓDIGO CORREGIDO: Usando JSON.stringify y decodeURIComponent para pasar el objeto
        const itemDataString = JSON.stringify(item);
        
        tableHTML += `
            <tr class="${alertClass}" data-index="${index}">
                <td>${statusIcon}</td>
                <td>${item.patrullaNombre}</td>
                <td>${item.movilDominio || (isBaseCheck ? 'Base Fija' : 'Puesto Fijo')}</td>
                <td>${supervisorDisplay}</td>
                <td>${item.timestamp ? item.timestamp.split(',')[0] : 'N/A'}</td>
                ${showMovilDetails ? `<td class="${combustibleAlertClass}">${combustibleDisplay}</td>` : ''}
                ${showMovilDetails ? `<td>${item.kilometraje || 'N/A'}</td>` : ''}
                <td>${vigiladoresSummary}</td>
                <td>
                    <button class="view-details-btn button-small" 
                            onclick="event.stopPropagation(); showDetailsModal(JSON.parse(decodeURIComponent('${encodeURIComponent(itemDataString)}')))">
                        Ver Detalle
                    </button>
                </td>
            </tr>
        `;
    });
    
    tableHTML += `</tbody></table>`;
    dataContainer.innerHTML = tableHTML;
};

// 🚨 CORRECCIÓN DE ÁMBITO: renderCards ahora es global (window.)
window.renderCards = (dataToRender) => {
    if (!dataContainer) return;
    let cardsHTML = `<div class="card-grid">`;

    dataToRender.forEach((item, index) => {
        const isAlert = hasAlert(item);
        const isInactivityAlert = item.inactividadAlerta;
        const isMovilCheck = currentSheet !== "Verificacion de objetivos MAC" && currentSheet !== "Verificacion de sitios Aysa";
        const isBaseCheck = currentSheet === "verificacion de bases";
        
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

        // 🚨 CÓDIGO CORREGIDO: Usando JSON.stringify y decodeURIComponent para pasar el objeto
        const itemDataString = JSON.stringify(item); // Definimos la variable dentro del bucle
                
        cardsHTML += `
            <div class="data-card ${cardClass}" data-index="${index}">
                <div class="card-header">
                    <h4>${item.patrullaNombre} - ${item.movilDominio || (isBaseCheck ? 'Base Fija' : 'Puesto Fijo')}</h4>
                    <span class="status-icon">${alertIconText}</span>
                </div>
                <p><strong>Fecha:</strong> ${item.timestamp ? item.timestamp.split(',')[0] : 'N/A'}</p>
                <p><strong>Supervisor:</strong> ${supervisorDisplay}</p>
                ${isMovilCheck && !isBaseCheck ? `<p><strong>Combustible:</strong> ${combustibleDisplay}</p>` : ''}
                <p><strong>Vigiladores:</strong> <ul>${vigiladoresSummary}</ul></p>
                <button class="view-details-btn button-full" 
                        onclick="event.stopPropagation(); showDetailsModal(JSON.parse(decodeURIComponent('${encodeURIComponent(itemDataString)}')))">
                    Ver Detalles Completos
                </button>
            </div>
        `;
    });
    
    cardsHTML += `</div>`;
    dataContainer.innerHTML = cardsHTML;
};

// Se mantiene showDetailsModal con corrección de color de capacitación
const showDetailsModal = (item) => {
    const isMovilCheck = currentSheet !== "Verificacion de objetivos MAC";
    const isBaseCheck = currentSheet === "verificacion de bases";
    
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

    } else if (isMovilCheck) { // Baterías/Patrullas, Sitios Aysa
        html += `
            <p><strong>Dominio/Móvil:</strong> ${item.movilDominio || 'N/A'}</p>
            <p><strong>Kilometraje:</strong> ${item.kilometraje || 'N/A'}</p>
            <p class="${item.combustibleFraccion && checkCombustible(item.combustibleFraccion).alerta ? 'text-danger' : ''}"><strong>Nivel de Combustible:</strong> ${item.combustibleFraccion || 'N/A'}</p>
            <p class="${getColorClass(item.higieneMovil)}"><strong>Higiene:</strong> ${item.higieneMovil || 'N/A'}</p>
            <p class="${getColorClass(item.poseeBotiquin)}"><strong>Posee Botiquín:</strong> ${item.poseeBotiquin || 'N/A'}</p>
        `;
    } else { // Objetivos MAC (Puesto Fijo)
        html += `<p>Dominio/Móvil: N/A - Puesto Fijo</p>`;
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
            const isCapacitacionAlert = isNegativeValue(v.capacitacion);
            const isRegAlert = isNegativeValue(v.regControlado);
            
            const faltas = [];
            if (isRegAlert) faltas.push('Falta Registro');
            if (isUniformeAlert) faltas.push('Falta Uniforme');
            
            // La falta de capacitación se informa, pero no es una 'alerta' grave principal
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
    
    modalBody.innerHTML = html;
    detailsModal.style.display = 'block';
};

// Event listeners para el modal
if (closeModal) {
    closeModal.onclick = () => { detailsModal.style.display = 'none'; };
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

const initialize = () => {
    if (searchInput) searchInput.addEventListener('input', window.filterAndSearch);
    if (alertFilter) alertFilter.addEventListener('change', window.filterAndSearch); 
    // Aseguramos que el redimensionamiento también use la función global
    window.addEventListener('resize', () => { if (sheetData.length > 0) window.renderData(sheetData); }); 

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
        // Obtenemos la fecha de hoy asegurando el formato YYYY-MM-DD (sin desfase)
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
                 const dailyRecorrido = JSON.parse(rawDailyRecorrido);
                 const supervisorName = activeSupervisor.includes('@') ? activeSupervisor.split('@')[0] : activeSupervisor;
                 
                 renderRecorridoForDate(selectedDate, supervisorName, dailyRecorrido);
            }
        });
    }

    // Carga Inicial
    const initialTab = document.querySelector(`.tab-button[data-sheet="${currentSheet}"]`);
    if (initialTab) {
        initialTab.classList.add('active');
    }
    
    loadData(currentSheet);
};

window.onload = initialize;