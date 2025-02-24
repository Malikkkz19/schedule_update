import * as path from 'path';
import { BuildEnv } from './config/build/config/types';
import { buildWebpackConfig } from './config/build/buildWebpackConfig';

export default (env: BuildEnv) => {
    const mode = env.mode || 'development';
    const isDev = mode === 'development';
    const port = env.port || 3000;
    const apiUrl = env.apiUrl || 'http://localhost:5000';

    return buildWebpackConfig({
        mode,
        paths: {
            entry: path.resolve(__dirname, 'src'),
            dist: path.resolve(__dirname, '../server/dist'),
            html: path.resolve(__dirname, 'public/index.html'),
            src: path.resolve(__dirname, 'src'),
        },
        isDev,
        port,
        apiUrl,
    });
};
