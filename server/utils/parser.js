const XLSX = require('xlsx');
const fs = require('fs');

function getRectangleFromExcel(fileName, rectangleVertices) {
    // Проверка, что fileName указывает на файл
    if (!fs.existsSync(fileName) || fs.lstatSync(fileName).isDirectory()) {
        throw new Error(`Указанный путь не является файлом: ${fileName}`);
    }

    const workbook = XLSX.readFile(fileName);

    const sheet_name_list = workbook.SheetNames;
    const worksheet = workbook.Sheets[sheet_name_list[0]];

    const vertices = rectangleVertices.split(':').map((vertex) => XLSX.utils.decode_cell(vertex));

    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // Проверка на пустые данные
    if (!data || data.length === 0) {
        console.warn('⚠️ Пустые данные в Excel файле');
        return [];
    }

    const selectedData = [];

    for (let col = vertices[0].c; col <= vertices[1].c; col++) {
        const columnData = [];
        for (let row = vertices[0].r; row <= vertices[1].r; row++) {
            // Проверка существования строки и ячейки
            if (data[row] && data[row][col] !== undefined) {
                columnData.push(data[row][col]);
            }
        }
        if (columnData.length > 0) {
            selectedData.push(columnData);
        }
    }

    // Проверка на пустые выбранные данные
    if (selectedData.length === 0) {
        console.warn('⚠️ Не удалось извлечь данные из указанного диапазона');
        return [];
    }

    const result = [];
    let realIndex = 0;

    for (let i = 0; i < selectedData.length; i++) {
        for (let j = 0; j < selectedData[i].length; j++) {
            result.push({
                date: '',
                jobs: [],
            });
        }
    }

    selectedData.forEach((column) => {
        let date = new Date();
        column.forEach((cell) => {
            if (cell === undefined) return;

            if (typeof cell === 'number' && /^\d+$/.test(cell.toString())) {
                date = new Date((cell - (25567 + 2)) * 86400 * 1000);
                result[realIndex].date = date;
            } else if (typeof cell === 'string') {
                if (cell.includes(`СР`)) {
                    const row = cell.split('\r\n');
                    result[realIndex].jobs.push(
                        `Тип занятия: ${row[0]}, дисциплина: ${row[0]}, аудитория: ${row[1] || 'Не указана'}`,
                    );
                } else if (cell.includes('\r\n')) {
                    const row = cell.split('\r\n');
                    result[realIndex].jobs.push(
                        `Тип занятия: ${row[0]}, дисциплина: ${row[1] || 'Не указана'}, аудитория: ${row[2] || 'Не указана'}`,
                    );
                }
            }
        });
        realIndex++;
    });

    return result;
}

function getRange(fileName, rectangleVertices) {
    // Проверка, что fileName указывает на файл
    if (!fs.existsSync(fileName) || fs.lstatSync(fileName).isDirectory()) {
        throw new Error(`Указанный путь не является файлом: ${fileName}`);
    }

    const workbook = XLSX.readFile(fileName);

    const sheet_name_list = workbook.SheetNames;
    const worksheet = workbook.Sheets[sheet_name_list[0]];

    const vertices = rectangleVertices.split(':').map((vertex) => XLSX.utils.decode_cell(vertex));

    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    const selectedData = [];

    for (let col = vertices[0].c; col <= vertices[1].c; col++) {
        const columnData = [];
        for (let row = vertices[0].r; row <= vertices[1].r; row++) {
            columnData.push(data[row][col]);
        }
        selectedData.push(columnData);
    }

    const str = [];
    for (let i = 0; i < selectedData.length; i++) {
        str.push([]);
    }

    selectedData.map((column, index) => {
        column.map((cell) => {
            if (cell) str[index].push(cell);
        });
    });

    const clearData = str.filter((cell) => cell.length);
    const subjects = [];
    for (let i = 0; i < clearData[0].length; i++) {
        subjects.push({
            abbr: clearData[0][i],
            title: clearData[1][i],
            kaf: ~~clearData[2][i],
            prepod: clearData[3][i],
        });
    }

    return subjects;
}

function getSubjectsFromExcel(filePath) {
    try {
        // Проверка, что fileName указывает на файл
        if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isDirectory()) {
            throw new Error(`Указанный путь не является файлом: ${filePath}`);
        }

        const workbook = XLSX.readFile(filePath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        
        const range = XLSX.utils.decode_range('A39:O51');
        const subjects = [];

        for (let row = range.s.r; row <= range.e.r; row++) {
            const subject = {};
            
            for (let col = range.s.c; col <= range.e.c; col++) {
                const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
                const cellValue = worksheet[cellAddress] ? worksheet[cellAddress].v : null;
                
                switch (col) {
                    case 0: subject.code = cellValue; break;
                    case 1: subject.name = cellValue; break;
                    case 2: subject.type = cellValue; break;
                    case 3: subject.hours = cellValue; break;
                }
            }

            if (subject.name) {
                subjects.push(subject);
            }
        }

        return subjects;
    } catch (error) {
        console.error('❌ Ошибка парсинга предметов:', error);
        throw error;
    }
}

module.exports = {
    getRectangleFromExcel,
    getRange,
    getSubjectsFromExcel
};