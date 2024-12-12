const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');
const mongoose = require('mongoose');
const { body, query, validationResult } = require('express-validator');
const winston = require('winston');

const { getRectangleFromExcel, getRange, getSubjectsFromExcel } = require('./utils/parser');
const { AudsModel, KafsModel } = require('./models/index');

// Настройка логирования
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.resolve(__dirname, './dist/')));

// Middleware для обработки ошибок
const errorHandler = (err, req, res, next) => {
    logger.error('Необработанная ошибка', { 
        message: err.message, 
        stack: err.stack,
        method: req.method,
        path: req.path
    });

    res.status(500).json({ 
        message: 'Внутренняя ошибка сервера', 
        error: process.env.NODE_ENV === 'development' ? err.message : null 
    });
};

// Database Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://database:27017/schedule-viewer';

const connectWithRetry = async () => {
    try {
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: false,
            useUnifiedTopology: false,
            retryWrites: false,  // Отключаем репликацию
            w: 1  // Простое подтверждение записи
        });
        console.log('✅ Успешное подключение к MongoDB');
    } catch (err) {
        console.error('❌ Ошибка подключения к MongoDB:', err);
        setTimeout(connectWithRetry, 5000);
    }
};

connectWithRetry();

// Валидация входных данных
const validateRequest = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(validation => validation.run(req)));
        
        const errors = validationResult(req);
        if (errors.isEmpty()) {
            return next();
        }

        return res.status(400).json({ errors: errors.array() });
    };
};

// Роут для удаления кафедры или аудитории с транзакцией
app.delete('/api/delete', 
    validateRequest([
        body('audId').optional().isMongoId().withMessage('Некорректный ID аудитории'),
        body('kafId').optional().isMongoId().withMessage('Некорректный ID кафедры')
    ]),
    async (req, res, next) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { audId, kafId } = req.body;
            console.log('🗑️ Запрос на удаление:', { audId, kafId });

            if (!audId && !kafId) {
                return res.status(400).json({ 
                    message: 'Необходимо указать ID для удаления' 
                });
            }

            if (audId) {
                // Удаление аудитории
                const deletedAud = await AudsModel.findByIdAndDelete(audId, { session });
                
                if (!deletedAud) {
                    console.warn(`⚠️ Аудитория с ID ${audId} не найдена`);
                    return res.status(404).json({ 
                        message: 'Аудитория не найдена' 
                    });
                }

                // Удаление ссылки на аудиторию из кафедр
                await KafsModel.updateMany(
                    { audsIds: audId },
                    { $pull: { audsIds: audId } },
                    { session }
                );
            }

            if (kafId) {
                // Удаление кафедры
                const deletedKaf = await KafsModel.findByIdAndDelete(kafId, { session });
                
                if (!deletedKaf) {
                    console.warn(`⚠️ Кафедра с ID ${kafId} не найдена`);
                    return res.status(404).json({ 
                        message: 'Кафедра не найдена' 
                    });
                }
            }

            await session.commitTransaction();

            console.log('✅ Удаление успешно завершено');
            return res.status(200).json({ 
                message: 'Объект успешно удален' 
            });
        } catch (error) {
            console.error('❌ Ошибка при удалении:', error);
            await session.abortTransaction();
            next(error);
        } finally {
            session.endSession();
        }
    }
);

// Роут для создания кафедры с валидацией
app.post('/api/create_kaf', 
    validateRequest([
        body('title').notEmpty().withMessage('Название кафедры обязательно')
    ]),
    async (req, res, next) => {
        try {
            const { title } = req.body;
            const createdKaf = await KafsModel.create({ title });
            
            logger.info('Создана новая кафедра', { kafId: createdKaf._id });
            return res.status(201).json(createdKaf);
        } catch (error) {
            next(error);
        }
    }
);

// Роут для добавления аудиторий к кафедре с улучшенной обработкой
app.post('/api/add_auds_to_kaf', 
    validateRequest([
        body('audsTitles').isArray().withMessage('Список аудиторий должен быть массивом'),
        body('parentKafId').isMongoId().withMessage('Некорректный ID кафедры')
    ]),
    async (req, res, next) => {
        try {
            console.log('🔍 Начало процесса добавления аудиторий');
            console.log('📥 Входящие данные:', req.body);
                
            const { parentKafId, audsTitles } = req.body;

            console.log('🕵️ Полная диагностика запроса:');
            console.log('Тип parentKafId:', typeof parentKafId);
            console.log('Значение parentKafId:', parentKafId);
            console.log('Длина audsTitles:', audsTitles.length);
            console.log('Типы элементов audsTitles:', audsTitles.map(a => typeof a));

            // Находим кафедру
            const parentKaf = await KafsModel.findById(parentKafId);
            console.log('🏫 Поиск кафедры по ID:', parentKafId);

            if (!parentKaf) {
                return res.status(404).json({ message: 'Кафедра не найдена' });
            }

            const newAuds = [];
            for (const audTitle of audsTitles) {
                console.log('🔎 Проверка аудитории:', audTitle);

                const existingAud = await AudsModel.findOne({ 
                    title: audTitle, 
                    parentKaf: parentKafId 
                });

                if (existingAud) {
                    console.log('🏠 Аудитория уже существует:', audTitle);
                    continue;
                }

                console.log('🆕 Создание новой аудитории:', audTitle);
                const newAud = new AudsModel({
                    title: audTitle,
                    parentKaf: parentKafId
                });

                await newAud.save();
                newAuds.push(newAud);
            }

            res.status(201).json({
                message: `Добавлено ${newAuds.length} новых аудиторий`,
                auds: newAuds
            });
        } catch (error) {
            console.error('❌ ПОЛНАЯ ОШИБКА:', error);
            next(error);
        }
    }
);

// Роут для получения расписания с расширенной логикой
app.get('/api/schedule', 
    validateRequest([
        query('workDir').notEmpty().withMessage('Путь к директории обязателен'),
        query('group').notEmpty().withMessage('Группа обязательна')
    ]),
    async (req, res, next) => {
        try {
            const { workDir, group, kafId } = req.query;
            const fullPath = path.resolve(__dirname, workDir, `${group}.xlsx`);

            const filePath = path.join(__dirname, workDir, `${group}.xlsx`);
            if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isDirectory()) {
                return res.status(400).json({ message: `Указанный путь не является файлом: ${filePath}` });
            }

            const schedule = getRectangleFromExcel(fullPath, 'D6:Z34');

            if (kafId) {
                const thisKaf = await KafsModel.findById(kafId).populate('audsIds');
                
                if (!thisKaf) {
                    return res.status(404).json({ message: 'Кафедра не найдена' });
                }

                const audsTitle = thisKaf.audsIds.map(aud => aud.title);
                
                const filteredSchedule = schedule.filter(day => 
                    day.jobs.some(job => 
                        audsTitle.some(title => 
                            job.includes(title) && 
                            !job.includes('самоподготовка') && 
                            !job.includes('хозяйственный день')
                        )
                    )
                );

                return res.status(200).json(filteredSchedule);
            }

            return res.status(200).json(schedule);
        } catch (error) {
            next(error);
        }
    }
);

// Роут для получения списка групп
app.get('/api/groups', 
    validateRequest([
        query('dir').notEmpty().withMessage('Директория обязательна')
    ]),
    async (req, res, next) => {
        try {
            const { dir } = req.query;
            
            // Логирование всех возможных путей
            console.log('🔍 Входящие параметры:');
            console.log('📥 Запрошенная директория:', dir);
            console.log('📂 Текущая директория (__dirname):', __dirname);
            console.log('🗃️ Корневая директория проекта:', path.resolve(__dirname, '..'));

            // Несколько вариантов преобразования пути
            const paths = [
                path.resolve(__dirname, '..', dir),           // Относительно корня проекта
                path.resolve(__dirname, dir),                 // Относительно server
                path.join(__dirname, '..', dir),              // Альтернативный join
                path.resolve(process.cwd(), dir),             // Текущая рабочая директория
                path.resolve('/', dir)                        // Корневой путь
            ];

            console.log('🌐 Проверяемые пути:', paths);

            // Проверка существования директорий
            const existingPaths = [];
            for (const testPath of paths) {
                try {
                    await fs.access(testPath);
                    existingPaths.push(testPath);
                    console.log(`✅ Существует путь: ${testPath}`);
                } catch {
                    console.log(`❌ Не существует путь: ${testPath}`);
                }
            }

            if (existingPaths.length === 0) {
                return res.status(404).json({ 
                    message: 'Ни один из путей не найден',
                    searchedPaths: paths
                });
            }

            // Используем первый существующий путь
            const fullPath = existingPaths[0];

            // Чтение файлов
            const files = await fs.readdir(fullPath);
            
            console.log('📄 Найденные файлы:', files);

            // Фильтрация и преобразование имен файлов
            const groups = files
                .filter(file => path.extname(file) === '.xlsx')
                .map(file => path.basename(file, '.xlsx'));

            console.log('👥 Группы:', groups);

            if (groups.length === 0) {
                return res.status(404).json({ 
                    message: 'В указанной директории нет Excel-файлов',
                    path: fullPath 
                });
            }

            return res.status(200).json(groups);
        } catch (error) {
            console.error('🚨 Полная ошибка при получении групп:', error);
            next(error);
        }
    }
);

// Роут для получения аудиторий
app.get('/api/fetch_auds', async (req, res, next) => {
    try {
        console.log('🔍 Запрос на получение аудиторий');
        const auds = await AudsModel.find({}).lean();
        
        console.log('📋 Найденные аудитории:', auds);
        
        if (!auds?.length) {
            console.warn('⚠️ Аудитории не найдены');
            return res.status(200).json({ 
                message: 'Аудитории не найдены',
                auds: [] 
            });
        }

        return res.status(200).json({ 
            message: 'Аудитории успешно получены',
            auds 
        });
    } catch (error) {
        console.error('❌ Ошибка при получении аудиторий:', error);
        next(error);
    }
});

// Роут для получения кафедр
app.get('/api/get_kafs', async (req, res, next) => {
    try {
        const kafs = await KafsModel.find({}).lean();
        console.log('🔍 Найденные кафедры:', kafs);
        res.json(kafs);
    } catch (error) {
        console.error('❌ Ошибка при получении кафедр:', error);
        next(error);
    }
});

// Роут для получения предметов
app.get('/api/subjects', async (req, res, next) => {
    try {
        const { group, workDir = 'files' } = req.query;
        console.log('📚 Запрос предметов:', { group, workDir });

        const fullPath = path.resolve(__dirname, '..', workDir, `${group}.xlsx`);
        console.log('📄 Полный путь к файлу:', fullPath);

        try {
            const subjects = getSubjectsFromExcel(fullPath);
            console.log('✅ Предметы извлечены:', subjects);
            return res.status(200).json(subjects);
        } catch (parseError) {
            console.error(`❌ Ошибка парсинга предметов для ${group}:`, parseError);
            return res.status(404).json({ 
                message: 'Не удалось извлечь предметы',
                error: parseError.message
            });
        }
    } catch (error) {
        console.error('🚨 Ошибка в роуте /api/subjects:', error);
        next(error);
    }
});

// Роут для получения расписания на сегодня
app.get('/api/today', async (req, res, next) => {
    try {
        const { workDir = 'files' } = req.query;
        console.log('🔍 Поиск файлов расписания в директории:', workDir);
        
        const fullWorkDir = path.resolve(__dirname, '..', workDir);
        console.log('📂 Полный путь к директории:', fullWorkDir);

        const files = await fs.readdir(fullWorkDir);
        const excelFiles = files.filter(file => 
            file.endsWith('.xlsx') || file.endsWith('.xls')
        );

        console.log('📄 Найденные Excel-файлы:', excelFiles);

        if (!excelFiles.length) {
            console.warn('⚠️ Excel-файлы не найдены');
            return res.status(404).json({ message: 'Файлы расписания не найдены' });
        }

        // Берем первый файл для примера
        const selectedFile = path.resolve(fullWorkDir, excelFiles[0]);
        
        console.log('📊 Выбран файл:', selectedFile);

        // Используем существующую логику парсинга
        const schedule = getRectangleFromExcel(selectedFile, 'A1:Z100');

        return res.status(200).json(schedule);
    } catch (error) {
        console.error('❌ Ошибка при получении расписания:', error);
        next(error);
    }
});

// Роут для поиска аудиторий по ID кафедры
app.get('/api/find_by_kaf', async (req, res, next) => {
    try {
        const { kafId } = req.query;

        const wantedKaf = await KafsModel.findOne({ _id: kafId }).populate({ path: 'audsIds' });
        if (!wantedKaf)
            return res.status(404).json({ message: `Кафедра с ID = ${kafId} не найдена` });

        const wantedAuds = wantedKaf.audsIds;
        if (!wantedAuds.length)
            return res
                .status(404)
                .json({ message: `За кафедрой с ID = ${kafId} аудитории не закреплены` });

        return res.status(200).json(wantedAuds);
    } catch (error) {
        next(error);
    }
});

// Диагностический роут для проверки кафедр
app.get('/api/debug/kafs', async (req, res) => {
    try {
        const kafs = await KafsModel.find({});
        console.log('🔍 Найденные кафедры:', kafs);
        res.json({
            count: kafs.length,
            kafs: kafs.map(kaf => ({
                id: kaf._id,
                title: kaf.title,
                audsCount: kaf.audsIds ? kaf.audsIds.length : 0
            }))
        });
    } catch (error) {
        console.error('❌ Ошибка при получении кафедр:', error);
        res.status(500).json({
            message: 'Ошибка получения кафедр',
            error: error.message
        });
    }
});

// Диагностический роут для создания кафедры
app.post('/api/debug/create_kaf', async (req, res) => {
    try {
        const { title } = req.body;
        if (!title) {
            return res.status(400).json({ message: 'Необходимо указать название кафедры' });
        }

        const existingKaf = await KafsModel.findOne({ title });
        if (existingKaf) {
            return res.status(200).json({ 
                message: 'Кафедра уже существует',
                kaf: existingKaf 
            });
        }

        const newKaf = await KafsModel.create({ 
            title,
            audsIds: [] 
        });

        console.log('🆕 Создана новая кафедра:', newKaf);

        res.status(201).json({ 
            message: 'Кафедра создана',
            kaf: {
                id: newKaf._id,
                title: newKaf.title
            }
        });
    } catch (error) {
        console.error('❌ Ошибка при создании кафедры:', error);
        res.status(500).json({ 
            message: 'Ошибка создания кафедры',
            error: error.message 
        });
    }
});

// Вспомогательная функция для получения расписания на сегодня
async function getTodaySchedule(workDir) {
    try {
        console.log('🔍 Поиск файлов расписания в директории:', workDir);
        
        const fullWorkDir = path.resolve(__dirname, '..', workDir);
        console.log('📂 Полный путь к директории:', fullWorkDir);

        const files = await fs.readdir(fullWorkDir);
        const excelFiles = files.filter(file => 
            file.endsWith('.xlsx') || file.endsWith('.xls')
        );

        console.log('📄 Найденные Excel-файлы:', excelFiles);

        if (!excelFiles.length) {
            console.warn('⚠️ Excel-файлы не найдены');
            return [];
        }

        // Берем первый файл для примера
        const selectedFile = path.resolve(fullWorkDir, excelFiles[0]);
        
        console.log('📊 Выбран файл:', selectedFile);

        // Используем существующую логику парсинга
        const schedule = getRectangleFromExcel(selectedFile, 'A1:Z100');

        return schedule;
    } catch (error) {
        console.error('❌ Ошибка при получении расписания:', error);
        throw error;
    }
}

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    console.error('🚨 Глобальная ошибка:', err);
    
    // Логируем полную информацию об ошибке
    console.error('Стек ошибки:', err.stack);
    console.error('Тело запроса:', req.body);
    console.error('Параметры запроса:', req.query);
    console.error('Параметры пути:', req.params);

    // Отправляем подробный ответ об ошибке
    res.status(500).json({
        message: 'Внутренняя ошибка сервера',
        error: process.env.NODE_ENV === 'development' 
            ? {
                name: err.name,
                message: err.message,
                stack: err.stack.split('\n')
            } 
            : 'Произошла непредвиденная ошибка'
    });
});

// Обработчик для неопределенных роутов
app.use((req, res, next) => {
    console.warn(`🚧 Запрос к несуществующему роуту: ${req.method} ${req.path}`);
    res.status(404).json({
        message: 'Роут не найден',
        path: req.path,
        method: req.method
    });
});

// Применение middleware обработки ошибок
app.use(errorHandler);

// Запуск сервера
app.listen(port, () => {
    logger.info(`Сервер запущен на порту ${port}`);
});