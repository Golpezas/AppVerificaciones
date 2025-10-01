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

// Función auxiliar para forzar la conversión de fecha de 'DD/MM/AAAA' a 'MM/DD/AAAA'
const normalizeDateForParsing = (timestampString) => {
    if (!timestampString) return null;

    // 1. Intentar encontrar el patrón de fecha DD/MM/AAAA.
    // Ej: "19/9/2025, 2:45:18 p.m."
    
    // Separamos la fecha de la hora (la hora puede tener a.m./p.m. o ser 24h)
    const [datePart, timePart] = timestampString.split(/[,\s]/, 2); // Divide por coma o espacio

    if (!datePart) return null;

    // 2. Extraer partes de la fecha (Día/Mes/Año)
    const dateParts = datePart.split('/');
    if (dateParts.length !== 3) {
        // Si no se encuentra el formato D/M/A, devolvemos el original para un intento simple
        return timestampString; 
    }
    
    // 3. Reordenar de DD/MM/AAAA a MM/DD/AAAA (formato americano seguro para new Date())
    // Y concatenar con el resto de la cadena de tiempo.
    const month = dateParts[1].trim();
    const day = dateParts[0].trim();
    const year = dateParts[2].trim();
    
    // Si hay una parte de tiempo, la concatenamos
    const normalizedTime = timestampString.substring(datePart.length).trim();
    
    return `${month}/${day}/${year}${normalizedTime}`; 
};

/**
 * Carga los datos de la API de Google Apps Script para una hoja específica y los ordena.
 */
const loadData = async (sheetName) => {
    currentSheet = sheetName;
    dataContainer.innerHTML = `<p class="loading-message">Cargando datos de **${sheetName}**, por favor espere...</p>`;
    supervisorSummary.innerHTML = '<p>Cargando sumario...</p>';
    
    const fullUrl = `${API_URL}?sheet=${encodeURIComponent(sheetName)}`;

    try {
        const response = await fetch(fullUrl);
        
        if (!response.ok) {
            throw new Error(`Error HTTP ${response.status}: No se pudo acceder a la API.`);
        }
        
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }
        
        sheetData = data; 
        
        // =========================================================================
        // 🚀 LÓGICA DE ORDENAMIENTO USANDO EL PARSEO
        // =========================================================================
        sheetData.sort((a, b) => {
            // Se normaliza la cadena y luego se convierte a Date
            const normalizedA = normalizeDateForParsing(a.timestamp);
            const normalizedB = normalizeDateForParsing(b.timestamp);
            
            const dateA = normalizedA ? new Date(normalizedA) : new Date(0); 
            const dateB = normalizedB ? new Date(normalizedB) : new Date(0);
            
            // Orden descendente (B - A): Más reciente primero
            return dateB.getTime() - dateA.getTime();
        });
        // =========================================================================

        sheetData = checkInactivity(sheetData); 
        updateSummaryData(sheetData); 
        filterAndSearch(); 
        
    } catch (error) {
        // ... (Manejo de errores sigue igual)
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
// 2. LÓGICA DE NEGOCIO Y ALERTAS
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

// Función auxiliar para determinar si la respuesta es una falta ('no', 'NO', 'No', 'Regular', 'Mala')
const isNegative = (value) => {
    if (!value) return false;
    const lowerValue = value.toString().toLowerCase().trim();
    return lowerValue === 'no' || lowerValue === 'regular' || lowerValue === 'mala';
};

/**
 * Genera un array de strings describiendo todas las faltas encontradas en Bases.
 * @param {object} item El objeto de datos del chequeo.
 * @returns {Array<string>} Lista de faltas.
 */
const getBasesAlertDetails = (item) => {
    const faltas = [];

    // Lista consolidada de TODOS los campos relevantes para Base (TODAS EN MINÚSCULA)
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

    // Chequeamos todos los campos de la lista
    baseCheckFields.forEach(field => {
        const fieldValue = item[field.key];
        if (isNegative(fieldValue)) {
            // Usamos la respuesta negativa real (NO, Regular, Mala)
            const displayValue = fieldValue.toUpperCase(); 
            faltas.push(`${field.label}: ${displayValue}`); 
        }
    });

    return faltas;
};

/**
 * Determina si debe existir una alerta CRÍTICA visible en la tabla.
 */
const hasAlert = (item) => {
    const checkMovil = currentSheet !== "Verificacion de objetivos MAC";
    const isBaseCheck = currentSheet === "verificacion de bases";

    if (isBaseCheck) {
        // La alerta se basa SOLO en si getBasesAlertDetails devuelve algo
        return getBasesAlertDetails(item).length > 0;
    }

    // Lógica para otras pestañas (Móviles/Objetivos/Sitios)
    
    // Alerta 1: Combustible bajo
    if (checkMovil && item.combustibleFraccion && checkCombustible(item.combustibleFraccion).alerta) {
        return true;
    }
    
    // Alerta 2: Faltas Críticas en Equipamiento 
    if (checkMovil) {
        if (isNegative(item.poseeBotiquin)) return true;
        if (isNegative(item.higieneMovil)) return true;
    }
    
    // Alerta 4: Faltas Críticas en Vigiladores (Uniforme, Registro/Presentación). 
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
        const timestamp = item.timestamp ? new Date(item.timestamp).getTime() : 0;
        
        if (!lastReports[key] || lastReports[key].timestamp < timestamp) {
            lastReports[key] = { timestamp: timestamp };
        }
    });

    const now = new Date().getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    return data.map((item) => {
        const key = item.patrullaNombre;
        const lastReport = lastReports[key];
        
        const hasPassedThreshold = lastReport.timestamp === 0 || (now - lastReport.timestamp) > twentyFourHours;
        
        item.inactividadAlerta = hasPassedThreshold;
        
        return item;
    });
};

const updateSummaryData = (data) => {
    const supervisorCounts = {};
    
    data.filter(item => item.patrullaNombre).forEach(item => {
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
// 3. RENDERIZADO Y BÚSQUEDA
// ====================================================================================================

/**
 * Define los encabezados de la tabla según la pestaña activa.
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
                <td><button class="view-details-btn button-small">Ver Detalle</button></td>
            </tr>
        `;
    });
    
    tableHTML += `</tbody></table>`;
    dataContainer.innerHTML = tableHTML;
};

const renderCards = (data) => {
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
            <div class="data-card ${cardClass}" data-index="${index}">
                <div class="card-header">
                    <h4>${item.patrullaNombre} - ${item.movilDominio || (isBaseCheck ? 'Base Fija' : 'Puesto Fijo')}</h4>
                    <span class="status-icon">${alertIconText}</span>
                </div>
                <p><strong>Fecha:</strong> ${item.timestamp ? item.timestamp.split(',')[0] : 'N/A'}</p>
                <p><strong>Supervisor:</strong> ${supervisorDisplay}</p>
                ${isMovilCheck && !isBaseCheck ? `<p><strong>Combustible:</strong> ${combustibleDisplay}</p>` : ''}
                <p><strong>Vigiladores:</strong> <ul>${vigiladoresSummary}</ul></p>
                <button class="view-details-btn button-full">Ver Detalles Completos</button>
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
 * Muestra todos los campos en el detalle, con texto explícito para las faltas.
 */
const showDetailsModal = (item) => {
    // ==========================================================
    // 🚨 PUNTO DE DEPURACIÓN CRÍTICO 🚨
    // ESTO MOSTRARÁ LA ESTRUCTURA DE DATOS REAL DEL BACKEND.
    // Presiona F12 en tu navegador, ve a la pestaña "Console" y haz clic en "Ver Detalle"
    // Busca el objeto desplegable para ver las claves reales (ej. 'poseeBotiquin' vs 'PoseeBotiquin').
    // ==========================================================
    console.log("==============================================================");
    console.log("INICIO DEPURACIÓN: Objeto de Base Completo Recibido");
    console.log(item); 
    console.log("==============================================================");
    
    // El resto de tu código de showDetailsModal:
    const isMovilCheck = currentSheet !== "Verificacion de objetivos MAC";
    const isBaseCheck = currentSheet === "verificacion de bases";
    
    let basesFaltas = []; 

    // Función auxiliar para obtener la clase de color (rojo si es 'No', verde si es 'Sí' o 'Buena')
    const getColorClass = (value) => {
        if (!value) return ''; // Evita errores si el valor es nulo o indefinido

        const lowerValue = value.toString().toLowerCase().trim();

        // 1. Valores de Falta (Rojo)
        if (lowerValue === 'no' || lowerValue === 'regular' || lowerValue === 'mala') {
            return 'text-danger';
        }

        // 2. Valores Positivos (Verde)
        // Incluimos 'si' y 'sí' para manejar la tilde y la capitalización.
        if (lowerValue === 'si' || lowerValue === 'sí' || lowerValue === 'buena') {
            return 'text-success';
        }
    
        // 3. Valor no mapeado (queda sin clase, por defecto negro)
        return ''; 

    };
    
    // Función auxiliar para determinar si el valor es negativo y debe ser mostrado
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
        // Obtenemos la lista completa de faltas para el encabezado del modal
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
        
        // Lista de todos los campos para el DETALLE del chequeo (TODAS LAS CLAVES EN MINÚSCULA)
        const baseDetailFields = [
            // Campos de Movilidad/Estado
            { label: "Dominio/Móvil", key: "movilDominio", checkAlert: false },
            { label: "Kilometraje", key: "kilometraje", checkAlert: false },
            { label: "Nivel de Combustible", key: "combustibleFraccion", checkAlert: false }, 
            { label: "Higiene de la Base", key: "higieneMovil", checkAlert: true },
            // Campos de Equipamiento (Restablecidos a Minúscula)
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

        // Itera para crear la sección "Información del Chequeo"
        baseDetailFields.forEach(field => {
             const value = item[field.key];
             
             // Si el valor existe y no es la cadena 'N/A' (para evitar campos vacíos)
             if (value && value.toString().trim().toUpperCase() !== 'N/A') {
                // Si es un campo de chequeo (Si/No/Regular/Mala), aplicamos el color de alerta
                const colorClass = field.checkAlert ? getColorClass(value) : '';

                // Agregamos el detalle
                baseDetailsHtml += `<p class="${colorClass}"><strong>${field.label}:</strong> ${value}</p>`;
                hasBaseInfo = true;
             }
        });

        if (hasBaseInfo) {
            html += baseDetailsHtml;
        }

    } else if (isMovilCheck) { // Baterías/Patrullas, Sitios Aysa
        // ... (Tu lógica para móviles/patrullas aquí)
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

    // 3. Observaciones Generales (Se muestran siempre si existen, ya no son alerta)
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
            
            // Recolectar las faltas en un array
            const faltas = [];
            if (isRegAlert) faltas.push('Falta Registro');
            if (isUniformeAlert) faltas.push('Falta Uniforme');
            if (isCapacitacionAlert) faltas.push('Falta Capacitación'); 
            
            const isVigiladorAlert = faltas.length > 0;

            // Mostrar el detalle de las faltas o un tick si está todo OK
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
// 4. INICIALIZACIÓN Y LISTENERS
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