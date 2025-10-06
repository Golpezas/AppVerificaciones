// ====================================================================================================
// 1. DATA Y CONFIGURACIÓN CRÍTICA
// ====================================================================================================

// 🛑 ¡PUNTO CRÍTICO! REEMPLAZA ESTA URL CON LA DE TU PROPIO DESPLIEGUE. 
// SI ESTA URL ES INCORRECTA O ESTÁ MAL DESPLEGADA, NINGÚN DATO SE MOSTRARÁ.
const API_URL = 'https://script.google.com/macros/s/AKfycbzDjq01yI157yqVUnRddgOrZS0Y7i2Vsdq23CD39lqoF6cHTNDiFYerxYRqXo2vE2Uysw/exec'; 

let currentSheet = "Verificacion de Baterias/Patrullas"; // Pestaña activa inicial
let sheetData = []; // La data cargada de la hoja activa

// Referencias del DOM (Se verifica si existen al inicio para evitar errores)
const dataContainer = document.getElementById('dataContainer');
const searchInput = document.getElementById('searchInput');
const alertFilter = document.getElementById('alertFilter');
const countDisplay = document.getElementById('countDisplay');
const detailsModal = document.getElementById('detailsModal');
const modalBody = document.getElementById('modalBody');
const closeModal = document.querySelector('.close-button');
const tabButtons = document.querySelectorAll('.tab-button');
const supervisorSummary = document.getElementById('supervisorSummary');

// Referencias del DOM para el Recorrido
const recorridoContainer = document.getElementById('recorridoContainer');
const recorridoInstructions = document.getElementById('recorridoInstructions');


// ====================================================================================================
// 2. FUNCIONES DE CARGA Y ORDENAMIENTO
// ====================================================================================================

/**
 * Función auxiliar que convierte la fecha del formato DD/MM/AAAA a MM/DD/AAAA
 * para que el constructor new Date() la interprete correctamente.
 */
const normalizeDateForParsing = (timestampString) => {
    if (!timestampString) return null;

    const parts = timestampString.split(', ');
    if (parts.length < 2) return timestampString;

    const datePart = parts[0].trim();
    const timePart = parts[1].trim();
    
    const dateParts = datePart.split('/');
    if (dateParts.length !== 3) return timestampString;
    
    const month = dateParts[1].trim();
    const day = dateParts[0].trim();
    const year = dateParts[2].trim();
    
    return `${month}/${day}/${year} ${timePart}`; 
};

// Función auxiliar para obtener un valor numérico comparable basado en la fecha y hora.
const getDateSortValue = (timestampString) => {
    const normalizedDateString = normalizeDateForParsing(timestampString);
    if (!normalizedDateString) return 0;
    
    const dateObj = new Date(normalizedDateString);
    if (isNaN(dateObj)) return 0;

    // Generar un número de ordenamiento YYYYMMDDHHMMSS
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getSeconds()).padStart(2, '0');

    return parseInt(`${year}${month}${day}${hours}${minutes}${seconds}`, 10);
};


const loadData = async (sheetName) => {
    currentSheet = sheetName;
    
    if (dataContainer) {
        dataContainer.innerHTML = `<p class="loading-message">Cargando datos de **${sheetName}**, por favor espere...</p>`;
    }
    if (supervisorSummary) {
        supervisorSummary.innerHTML = '<p>Cargando sumario...</p>';
    }
    // Limpiar recorrido al cambiar de pestaña
    if (recorridoContainer && recorridoInstructions) {
        recorridoContainer.innerHTML = ''; 
        recorridoInstructions.textContent = 'Haz clic en una fila de la tabla para ver el recorrido completo de ese supervisor.';
    }
    
    const fullUrl = `${API_URL}?sheet=${encodeURIComponent(sheetName)}`;

    try {
        const response = await fetch(fullUrl);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }
        
        sheetData = data; 
        
        // 🚀 LÓGICA DE ORDENAMIENTO MANUAL POR FECHA (Más Reciente a Más Antiguo)
        sheetData.sort((a, b) => {
            const sortValueA = getDateSortValue(a.timestamp); 
            const sortValueB = getDateSortValue(b.timestamp);
            return sortValueB - sortValueA;
        });

        sheetData = checkInactivity(sheetData); 
        updateSummaryData(sheetData); 
        filterAndSearch(); 
        
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
// 3. LÓGICA DE NEGOCIO Y ALERTAS (Las funciones hasAlert, checkCombustible, etc. se mantienen igual)
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

    const now = new Date().getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    return data.map((item) => {
        const key = item.patrullaNombre;
        const lastReport = lastReports[key];
        
        const lastReportDate = lastReport && lastReport.timestamp ? new Date(normalizeDateForParsing(lastReport.timestamp)).getTime() : 0;

        const hasPassedThreshold = lastReportDate === 0 || (now - lastReportDate) > twentyFourHours;
        
        // Solo la última fila (la más reciente) debe tener la alerta de inactividad
        const isLatestReport = item.timestamp && getDateSortValue(item.timestamp) === lastReport.sortValue;
        
        item.inactividadAlerta = isLatestReport && hasPassedThreshold;
        
        return item;
    });
};

const updateSummaryData = (data) => {
    // ... (La lógica de updateSummaryData se mantiene igual)
    const supervisorCounts = {};
    
    data.filter(item => item.emailSupervisor).forEach(item => {
        const key = item.emailSupervisor || 'Sin Supervisor';
        supervisorCounts[key] = (supervisorCounts[key] || 0) + 1;
    });

    let html = '<h4>Objetivos Recorridos por Supervisor:</h4><ul>';
    const sortedSupervisors = Object.entries(supervisorCounts).sort(([, a], [, b]) => b - a);

    if (sortedSupervisors.length > 0) {
        sortedSupervisors.forEach(([supervisor, count]) => {
            const displaySupervisor = supervisor.includes('@') ? supervisor.split('@')[0] : supervisor; 
            html += `<li><strong>${displaySupervisor}</strong>: ${count} chequeos</li>`;
        });
    } else {
        html = '<p>No hay registros válidos de supervisores en esta hoja.</p>';
    }
    
    html += '</ul>';
    if(supervisorSummary) supervisorSummary.innerHTML = html;
};


// ====================================================================================================
// 4. LÓGICA DE RECORRIDO (Aseguramos que el acceso a DOM sea seguro)
// ====================================================================================================

/**
 * Agrupa las verificaciones de un supervisor por día y asegura el orden cronológico.
 */
const groupRecorridoByDay = (data) => {
    const dailyRecorrido = {};

    data.forEach(item => {
        const normalizedDate = normalizeDateForParsing(item.timestamp);
        if (!normalizedDate) return;

        const dateObj = new Date(normalizedDate);
        
        // Formato para la clave de agrupación: YYYY-MM-DD
        const dayKey = dateObj.toISOString().split('T')[0];

        if (!dailyRecorrido[dayKey]) {
            dailyRecorrido[dayKey] = [];
        }
        
        dailyRecorrido[dayKey].push(item);
    });

    // Asegurarse de que los chequeos dentro de cada día estén ordenados por hora (el más antiguo primero)
    for (const day in dailyRecorrido) {
        dailyRecorrido[day].sort((a, b) => {
            const timeA = new Date(normalizeDateForParsing(a.timestamp)).getTime();
            const timeB = new Date(normalizeDateForParsing(b.timestamp)).getTime();
            return timeA - timeB; 
        });
    }

    return dailyRecorrido;
};

/**
 * Muestra el recorrido del supervisor seleccionado.
 */
window.showSupervisorRecorrido = (emailSupervisor) => {
    if (!recorridoContainer || !recorridoInstructions) {
         console.warn("Error: recorridoContainer o recorridoInstructions no están definidos. ¿Faltan IDs en el HTML?");
         return;
    }

    // 1. Filtrar los datos globales por el supervisor
    const supervisorData = sheetData.filter(item => item.emailSupervisor === emailSupervisor);

    if (supervisorData.length === 0) {
        recorridoContainer.innerHTML = `<p class="text-danger">No se encontraron chequeos para ${emailSupervisor}.</p>`;
        recorridoInstructions.innerHTML = `<p>Recorrido de: <strong>${emailSupervisor}</strong></p>`;
        return;
    }

    // 2. Agrupar por día y ordenar
    const dailyRecorrido = groupRecorridoByDay(supervisorData);

    // 3. Renderizar el HTML
    let html = '';
    const sortedDays = Object.keys(dailyRecorrido).sort().reverse(); 
    const supervisorName = emailSupervisor.includes('@') ? emailSupervisor.split('@')[0] : emailSupervisor;

    sortedDays.forEach(day => {
        const checks = dailyRecorrido[day];
        const displayDate = checks[0].timestamp.split(',')[0].trim(); 

        html += `<div class="card recorrido-day-card">
                    <div class="card-header">Día: <strong>${displayDate}</strong> (${checks.length} Chequeos)</div>
                    <ul class="list-group list-group-flush">`;

        checks.forEach((check) => {
            const timePart = check.timestamp.split(',')[1].trim(); 
            const isAlert = hasAlert(check); 
            
            // CORRECCIÓN CRÍTICA: Escapar el JSON para el onclick
            // Usamos encodeURIComponent para pasar el objeto completo al modal sin problemas
            // y luego JSON.parse(decodeURIComponent(...)) para recuperarlo
            const checkDataString = JSON.stringify(check); 

            html += `
                <li class="list-group-item recorrido-item ${isAlert ? 'item-alert' : ''}">
                    <span class="item-time">[${timePart}]</span> 
                    <span class="item-location">Chequeo en <strong>${check.patrullaNombre || 'Ubicación Desconocida'}</strong></span>
                    <button class="btn-detail" 
                            onclick="event.stopPropagation(); showDetailsModal(JSON.parse(decodeURIComponent('${encodeURIComponent(checkDataString)}')))">
                        ${isAlert ? '🚨 Ver Faltas' : '✅ Detalle'}
                    </button>
                </li>
            `;
        });

        html += `</ul></div>`;
    });
    
    recorridoInstructions.innerHTML = `<p>Recorrido detallado para: <strong>${supervisorName}</strong></p>`;
    recorridoContainer.innerHTML = html;

    recorridoContainer.scrollIntoView({ behavior: 'smooth' });
};


// ====================================================================================================
// 5. RENDERIZADO Y BÚSQUEDA (Aseguramos que dataContainer exista)
// ====================================================================================================

const getDynamicHeaders = () => {
    // ... (La lógica de getDynamicHeaders se mantiene igual)
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
        ...((currentSheet === "Verificacion de objetivos MAC" || currentSheet === "verificacion de bases") ? [''] : ['Combustible', 'Km']), 
        'Vigiladores (U/R)', 
        'Detalles'
    ];
    
    return headers.filter(h => h.trim() !== '');
};

const renderData = (dataToRender) => {
    if (!dataContainer) {
         console.warn("Error: dataContainer no está definido. ¿Falta el ID en el HTML?");
         return;
    }

    dataContainer.innerHTML = '';
    if (countDisplay) countDisplay.textContent = dataToRender.length;
    
    if (window.innerWidth > 900) {
        renderTable(dataToRender);
    } else {
        renderCards(dataToRender);
    }
};

const renderTable = (data) => {
    // ... (renderTable se mantiene igual, verificando solo que dataContainer exista)
    if (!dataContainer) return;
    const headers = getDynamicHeaders();
    const isMovilCheck = currentSheet !== "Verificacion de objetivos MAC";
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
    
    data.forEach((item, index) => {
        const isAlert = hasAlert(item);
        const isInactivityAlert = item.inactividadAlerta;
        
        let alertClass = '';
        // Alerta de Inactividad solo para la fila más reciente
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
        
        const supervisorEmail = item.emailSupervisor || 'N/A';

        // 🛑 LÍNEA CRÍTICA: La fila completa llama a showSupervisorRecorrido
        tableHTML += `
            <tr class="${alertClass}" data-index="${index}" onclick="showSupervisorRecorrido('${supervisorEmail}')">
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
                            onclick="event.stopPropagation(); showDetailsModal(sheetData[${index}])">
                        Ver Detalle
                    </button>
                </td>
            </tr>
        `;
    });
    
    tableHTML += `</tbody></table>`;
    dataContainer.innerHTML = tableHTML;
};

// ... (renderCards se mantiene igual)

const filterAndSearch = () => {
    let filteredData = sheetData;
    // ... (La lógica de filtro se mantiene igual)
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
    renderData(filteredData);
};

// ... (showDetailsModal se mantiene igual)

/**
 * Función que inicializa los listeners y la carga de datos.
 */
const initialize = () => {
    if (searchInput) searchInput.addEventListener('input', filterAndSearch);
    if (alertFilter) alertFilter.addEventListener('change', filterAndSearch); 
    window.addEventListener('resize', () => { if (sheetData.length > 0) renderData(sheetData); }); 

    tabButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const sheetName = event.target.dataset.sheet;
            tabButtons.forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            loadData(sheetName);
        });
    });

    // Carga Inicial
    const initialTab = document.querySelector(`.tab-button[data-sheet="${currentSheet}"]`);
    if (initialTab) {
        initialTab.classList.add('active');
    }
    
    // Verificación final de la existencia del contenedor principal de la tabla
    if (!dataContainer) {
        console.error("CRITICAL ERROR: El elemento con ID 'dataContainer' no se encontró en el HTML.");
    }

    loadData(currentSheet);
};

// ====================================================================================================
// 6. INICIALIZACIÓN
// ====================================================================================================

window.onload = initialize;