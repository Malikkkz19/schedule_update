const { MongoClient } = require('mongodb');

async function initReplicaSet() {
    try {
        const client = await MongoClient.connect('mongodb://database:27017', { 
            useNewUrlParser: true,
            useUnifiedTopology: true,
            connectTimeoutMS: 10000,  // 10 секунд на подключение
            socketTimeoutMS: 45000    // 45 секунд на операции
        });

        // Проверка подключения
        if (!client.isConnected()) {
            throw new Error('Не удалось установить подключение к MongoDB');
        }

        const adminDb = client.db('admin');
        
        try {
            await adminDb.command({
                replSetInitiate: {
                    _id: "rs0",
                    members: [
                        { _id: 0, host: "database:27017" }
                        // Можно добавить резервные узлы, если они есть
                    ]
                }
            });

            console.log('✅ Replica set успешно инициализирован');
        } catch (initError) {
            // Обработка ошибок инициализации реплика-сета
            console.warn('⚠️ Возможно, replica set уже инициализирован:', initError.message);
        }

        await client.close();
    } catch (error) {
        console.error('❌ Критическая ошибка инициализации replica set:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        // Более мягкий выход
        process.exitCode = 1;
    }
}

initReplicaSet();
