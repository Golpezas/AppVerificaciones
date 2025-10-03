// ====================================================================================================
// 1. DATA Y CONFIGURACIÓN
// ====================================================================================================

// URL de la API de Apps Script
// ¡REEMPLAZA ESTA URL CON LA DE TU PROPIO DESPLIEGUE!
const API_URL = 'https://script.google.com/macros/s/AKfycbzDjq01yI157yqVUnRddgOrZS0Y7i2Vsdq23CD39lqoF6cHTNDiFYerxYRqXo2vE2Uysw/exec'; 

let sheetData = []; 
let currentSheet = "Verificacion de Baterias/Patrullas"; // Pestaña activa inicial

// Referencias del DOM
const dataContainer = document.getElementById('dataContainer');
const searchInput = document.getElementById('searchInput');
const alertFilter = document.getElementById('alertFilter');
const countDisplay = document.getElementById('countDisplay');
const detailsModal = document.getElementById('detailsModal');
const modalBody = document.getElementById('modalBody');
const closeModal = document.querySelector('.close-button');
const tabButtons = document.querySelectorAll('.tab-button');
const supervisorSummary = document.getElementById('supervisorSummary');

// Nuevas referencias del DOM para el Recorrido
const recorridoContainer = document.getElementById('recorridoContainer');
const recorridoInstructions = document.getElementById('recorridoInstructions');


// Función auxiliar para obtener un valor numérico comparable basado en la fecha y hora.
const getDateSortValue = (timestampString) => {
    if (!timestampString) return 0; // Valor cero para los nulos (irán al inicio)

    // Formato de Apps Script: "DD/MM/AAAA, HH:MM:SS p.m." (ej. 19/9/2025, 2:45:18 p.m.)
    
    // 1. Separar la fecha y la hora
    const [datePart, timePart] = timestampString.split(', ');
    if (!datePart || !timePart) return 0; // Fallback si el formato no es el esperado

    // 2. Obtener partes de la fecha (DD, MM, AAAA)
    const dateParts = datePart.split('/');
    if (dateParts.length !== 3) return 0;

    const day = dateParts[0].padStart(2, '0'); // 19 -> "19"
    const month = dateParts[1].padStart(2, '0'); // 9 -> "09"
    const year = dateParts[2]; // 2025

    // 3. Obtener partes de la hora y convertir a 24 horas (HH, MM, SS)
    const [hms, ampm] = timePart.split(' ');
    const [rawHour, minute, second] = hms.split(':');
    let hour = parseInt(rawHour);

    // Conversión a formato 24 horas
    if (ampm && ampm.toLowerCase() === 'p.m.' && hour !== 12) {
        hour += 12;
    } else if (ampm && ampm.toLowerCase() === 'a.m.' && hour === 12) {
        hour = 0; // Medianoche (12:xx:xx a.m.)
    }
    
    // Formatear la hora a dos dígitos
    const formattedHour = String(hour).padStart(2, '0');
    const formattedMinute = minute.padStart(2, '0');
    const formattedSecond = second.padStart(2, '0');

    // 4. Crear una cadena de número largo: AAAAMMDDHHMMSS
    // Este número es comparable directamente. El más grande es el más reciente.
    const sortValue = `${year}${month}${day}${formattedHour}${formattedMinute}${formattedSecond}`;
    
    // Devolvemos el valor como un número entero para la comparación
    return parseInt(sortValue, 10);
};

/**
 * Función auxiliar que convierte la fecha del formato DD/MM/AAAA a MM/DD/AAAA
 * para que el constructor new Date() la interprete correctamente.
 */
const normalizeDateForParsing = (timestampString) => {
    if (!timestampString) return null;

    // Patrón: DD/MM/AAAA, HH:MM:SS p.m.
    const parts = timestampString.split(', ');
    if (parts.length < 2) return timestampString; // No es el formato esperado, devolvemos original

    const datePart = parts[0];
    const timePart = parts[1];
    
    // Extraer partes de la fecha (Día/Mes/Año)
    const dateParts = datePart.split('/');
    if (dateParts.length !== 3) {
        return timestampString; 
    }
    
    // Reordenar a MM/DD/AAAA
    const month = dateParts[1].trim();
    const day = dateParts[0].trim();
    const year = dateParts[2].trim();
    
    return `${month}/${day}/${year}, ${timePart}`; 
};


const loadData = async (sheetName) => {
    currentSheet = sheetName;
    dataContainer.innerHTML = `<p class="loading-message">Cargando datos de **${sheetName}**, por favor espere...</p>`;
    supervisorSummary.innerHTML = '<p>Cargando sumario...</p>';
    recorridoContainer.innerHTML = ''; // Limpiar recorrido al cambiar de pestaña
    recorridoInstructions.textContent = 'Haz clic en una fila de la tabla para ver el recorrido completo de ese supervisor.';
    
    const fullUrl = `${API_URL}?sheet=${encodeURIComponent(sheetName)}`;

    try {
        const response = await fetch(fullUrl);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }
        
        sheetData = data; 
        
        // 🚀 LÓGICA DE ORDENAMIENTO MANUAL POR NÚMERO (Más Reciente a Más Antiguo)
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
        const displayError = error.message.includes('split is not function') ? 
                             "Error de formato de datos (v.nombre o supervisor vacío/nulo). Revise el backend." : 
                             error.message;

        dataContainer.innerHTML = `<p class="text-danger">❌ **Error de Conexión:** ${displayError}</p>`;
        countDisplay.textContent = 0;
        supervisorSummary.innerHTML = `<p class="text-danger">Error: No se pudo cargar el sumario.</p>`;
    }
};

// ====================================================================================================
// 2. LÓGICA DE NEGOCIO Y ALERTAS (Sin cambios importantes, se mantiene tu código)
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
        const timestamp = item.timestamp ? getDateSortValue(item.timestamp) : 0; // Usar getDateSortValue
        
        if (!lastReports[key] || lastReports[key].sortValue < timestamp) {
            lastReports[key] = { sortValue: timestamp };
        }
    });

    const now = new Date().getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    return data.map((item) => {
        const key = item.patrullaNombre;
        const lastReport = lastReports[key];
        
        // Convertir el sortValue (AAAAMMDDHHMMSS) a una fecha real para la comparación de inactividad
        const lastReportDate = item.timestamp ? new Date(normalizeDateForParsing(item.timestamp)).getTime() : 0;
        
        const hasPassedThreshold = lastReportDate === 0 || (now - lastReportDate) > twentyFourHours;
        
        item.inactividadAlerta = hasPassedThreshold;
        
        return item;
    });
};

const updateSummaryData = (data) => {
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
    supervisorSummary.innerHTML = html;
};


// ====================================================================================================
// 3. LÓGICA DE RECORRIDO (NUEVO)
// ====================================================================================================

/**
 * Agrupa las verificaciones de un supervisor por día y asegura el orden cronológico.
 */
const groupRecorridoByDay = (data) => {
    const dailyRecorrido = {};

    data.forEach(item => {
        // Usamos normalizeDateForParsing para asegurar que new Date() funcione.
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
 * Muestra el recorrido del supervisor seleccionado en el nuevo contenedor.
 * Se llama al hacer clic en una fila de la tabla principal.
 */
window.showSupervisorRecorrido = (emailSupervisor) => {
    // 1. Filtrar los datos globales por el supervisor
    const supervisorData = sheetData.filter(item => item.emailSupervisor === emailSupervisor);

    if (!recorridoContainer || !recorridoInstructions) return;

    if (supervisorData.length === 0) {
        recorridoContainer.innerHTML = `<p class="text-danger">No se encontraron chequeos para ${emailSupervisor}.</p>`;
        recorridoInstructions.innerHTML = `<p>Recorrido de: <strong>${emailSupervisor}</strong></p>`;
        return;
    }

    // 2. Agrupar por día y ordenar
    const dailyRecorrido = groupRecorridoByDay(supervisorData);

    // 3. Renderizar el HTML
    let html = '';
    // Ordenar las fechas de los días de más reciente a más antigua
    const sortedDays = Object.keys(dailyRecorrido).sort().reverse(); 

    sortedDays.forEach(day => {
        const checks = dailyRecorrido[day];
        
        // Formato de fecha visible (DD/MM/AAAA)
        const displayDate = checks[0].timestamp.split(',')[0].trim(); 
        const supervisorName = emailSupervisor.split('@')[0];

        html += `
            <div class="card recorrido-day-card">
                <div class="card-header">
                    Día: <strong>${displayDate}</strong> (${checks.length} Chequeos)
                </div>
                <ul class="list-group list-group-flush">
        `;

        checks.forEach((check, index) => {
            const timePart = check.timestamp.split(',')[1].trim().split(' ')[0]; // Solo HH:MM:SS
            const ampmPart = check.timestamp.split(' ')[2] || ''; // AM/PM
            const locationName = check.patrullaNombre || 'Ubicación Desconocida';
            const hasAlert = hasAlert(check); // Usamos la función hasAlert para las faltas
            
            // Usamos JSON.stringify para pasar el objeto al modal de forma segura
            const checkData = JSON.stringify(check).replace(/"/g, '&quot;');

            html += `
                <li class="list-group-item recorrido-item ${hasAlert ? 'item-alert' : ''}">
                    <span class="item-time">#${index + 1} - [${timePart} ${ampmPart}]</span> 
                    <span class="item-location">Chequeo en <strong>${locationName}</strong></span>
                    <button class="btn-detail" 
                            onclick="showDetailsModal(${checkData})">
                        ${hasAlert ? '🚨 Ver Faltas' : '✅ Detalle'}
                    </button>
                </li>
            `;
        });

        html += `
                </ul>
            </div>
        `;
    });
    
    instructions.innerHTML = `<p>Recorrido detallado para: <strong>${supervisorName}</strong></p>`;
    recorridoContainer.innerHTML = html;

    // Scroll hasta el nuevo contenedor para que el usuario lo vea
    recorridoContainer.scrollIntoView({ behavior: 'smooth' });
};
// ====================================================================================================


// ====================================================================================================
// 4. RENDERIZADO Y BÚSQUEDA (MODIFICADO)
// ====================================================================================================

/**
 * Define los encabezados de la tabla según la pestaña activa. (Sin cambios)
 */
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
        // Ocultar combustible/kilometraje en MAC y Bases (puesto fijo)
        ...((currentSheet === "Verificacion de objetivos MAC" || currentSheet === "verificacion de bases") ? [''] : ['Combustible', 'Km']), 
        'Vigiladores (U/R)', 
        'Detalles'
    ];
    
    return headers.filter(h => h.trim() !== '');
};

const renderData = (dataToRender) => {
    dataContainer.innerHTML = '';
    countDisplay.textContent = dataToRender.length;
    
    if (window.innerWidth > 900) {
        renderTable(dataToRender);
    } else {
        renderCards(dataToRender);
    }
    
    // Reemplazamos la lógica de los botones por la función del modal directo
    document.querySelectorAll('.view-details-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const index = e.target.closest('tr, .data-card').dataset.index; 
            showDetailsModal(dataToRender[index]);
        });
    });
};

const renderTable = (data) => {
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
        
        // Determinar si mostrar Combustible/Km
        const showMovilDetails = isMovilCheck && !isBaseCheck;
        
        // MODIFICACIÓN CLAVE: Agregar el onclick a la fila para el recorrido
        const supervisorEmail = item.emailSupervisor || 'N/A';

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
                <td><button class="view-details-btn button-small" onclick="event.stopPropagation()">Ver Detalle</button></td>
            </tr>
        `;
    });
    
    tableHTML += `</tbody></table>`;
    dataContainer.innerHTML = tableHTML;
};

const renderCards = (data) => {
    // La lógica de renderCards debe ser similar a renderTable para ser interactiva,
    // pero por simplicidad de código, solo la actualizaremos para incluir el data-index
    // y mantener el código original. La interacción se centrará en la tabla por ahora.
    let cardsHTML = `<div class="card-grid">`;
    
    data.forEach((item, index) => {
        const isAlert = hasAlert(item);
        const isInactivityAlert = item.inactividadAlerta;
        const isMovilCheck = currentSheet !== "Verificacion de objetivos MAC";
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
        
        cardsHTML += `
            <div class="data-card ${cardClass}" data-index="${index}" onclick="showSupervisorRecorrido('${item.emailSupervisor}')">
                <div class="card-header">
                    <h4>${item.patrullaNombre} - ${item.movilDominio || (isBaseCheck ? 'Base Fija' : 'Puesto Fijo')}</h4>
                    <span class="status-icon">${alertIconText}</span>
                </div>
                <p><strong>Fecha:</strong> ${item.timestamp ? item.timestamp.split(',')[0] : 'N/A'}</p>
                <p><strong>Supervisor:</strong> ${supervisorDisplay}</p>
                ${isMovilCheck && !isBaseCheck ? `<p><strong>Combustible:</strong> ${combustibleDisplay}</p>` : ''}
                <p><strong>Vigiladores:</strong> <ul>${vigiladoresSummary}</ul></p>
                <button class="view-details-btn button-full" onclick="event.stopPropagation()">Ver Detalles Completos</button>
            </div>
        `;
    });
    
    cardsHTML += `</div>`;
    dataContainer.innerHTML = cardsHTML;
};

const filterAndSearch = () => {
    let filteredData = sheetData;
    const searchTerm = searchInput.value.toLowerCase().trim();
    const alertValue = alertFilter.value;
    
    // 1. Filtrar por Alerta (solo si se selecciona "alerts")
    if (alertValue === 'alerts') {
        filteredData = filteredData.filter(item => hasAlert(item) || item.inactividadAlerta);
    }
    
    // 2. Buscar por Término
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

/**
 * Muestra todos los campos en el detalle, con texto explícito para las faltas. (Sin cambios)
 */
const showDetailsModal = (item) => {
    // ==========================================================
    console.log("==============================================================");
    console.log("INICIO DEPURACIÓN: Objeto de Base Completo Recibido");
    console.log(item); 
    console.log("==============================================================");
    
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
    
    const isAlertValue = (value) => {
        if (!value) return false;
        const lowerValue = value.toString().toLowerCase();
        return lowerValue === 'no' || lowerValue === 'regular' || lowerValue === 'mala';
    };

    // 1. Detalles Generales (siempre presentes)
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
            const isUniformeAlert = isNegative(v.uniformeCompleto);
            const isCapacitacionAlert = isNegative(v.capacitacion);
            const isRegAlert = isNegative(v.regControlado);
            
            const faltas = [];
            if (isRegAlert) faltas.push('Falta Registro');
            if (isUniformeAlert) faltas.push('Falta Uniforme');
            if (isCapacitacionAlert) faltas.push('Falta Capacitación'); 
            
            const isVigiladorAlert = faltas.length > 0;

            const statusDisplay = isVigiladorAlert 
                ? `<span class="text-danger">🚨 **Falta:** ${faltas.join(', ')}</span>`
                : `<span class="text-success">✅ OK</span>`;
            
            html += `<div class="vigilador-detail">
                <h5>Vigilador ${i + 1} (${v.legajo || 'N/A'}) - ${v.nombre || 'N/A'}</h5>
                <p><strong>Estado:</strong> ${statusDisplay}</p>
                
                <p class="${getColorClass(v.regControlado)}"><strong>Registro Controlado / Presentación:</strong> ${v.regControlado || 'N/A'}</p>
                <p class="${getColorClass(v.uniformeCompleto)}"><strong>Uniforme Completo:</strong> ${v.uniformeCompleto || 'N/A'}</p>
                
                <p class="${isCapacitacionAlert ? 'text-danger' : 'text-success'}"><strong>Capacitación Realizada:</strong> ${v.capacitacion || 'N/A'}</p>
                
                <p><strong>Observaciones:</strong> ${v.observaciones || 'N/A'}</p>
            </div>`;
        });
    } else {
        html += `<p>No se registraron vigiladores para este chequeo.</p>`;
    }
    
    modalBody.innerHTML = html;
    detailsModal.style.display = 'block';
};

closeModal.onclick = () => { detailsModal.style.display = 'none'; };
window.onclick = (event) => {
    if (event.target == detailsModal) {
        detailsModal.style.display = 'none';
    }
};

// ====================================================================================================
// 5. INICIALIZACIÓN Y LISTENERS (MODIFICADO)
// ====================================================================================================

const handleTabChange = (event) => {
    const sheetName = event.target.dataset.sheet;
    
    tabButtons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    loadData(sheetName);
};

// Escuchas para los controles
searchInput.addEventListener('input', filterAndSearch);
alertFilter.addEventListener('change', filterAndSearch); 
window.addEventListener('resize', () => { if (sheetData.length > 0) renderData(sheetData); }); 

// Escucha para los botones de pestaña
tabButtons.forEach(button => {
    button.addEventListener('click', handleTabChange);
});

// Carga Inicial
window.onload = () => {
    // Asegúrate de que el botón de la pestaña inicial tenga la clase 'active' al cargar.
    const initialTab = document.querySelector(`.tab-button[data-sheet="${currentSheet}"]`);
    if (initialTab) {
        initialTab.classList.add('active');
    }
    loadData(currentSheet);
};