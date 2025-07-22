const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    // Request the mapper configuration from the extension
    vscode.postMessage({ command: 'webviewLoaded' });

    // Handle messages from the extension
    window.addEventListener('message', async (event) => {
        const message = event.data;
        if (message.command === 'fileContent') {
            const mapConfig = message.mapConfig;
            const mapper = JSON.parse(message.content);
            displayMapperContent(mapper, mapConfig.file);
        } else if (message.command === 'error') {
            console.error('Error from extension:', message.message);
        }
    });

    // Function to display the content of a mapper file
    function displayMapperContent(mapper, filePath) {
        showJsonContent(`File Path: ${filePath}`, mapper, "jsonContent", (key, value, valueSpan) => {
            if (typeof value === 'string') {
                if (key === 'items' && value !== '$original') {
                    valueSpan.title = 'Click to load nested mapper';
                    valueSpan.classList.add('json-viewer-json-mapper');
                    valueSpan.textContent = `"${value}"`;
                    valueSpan.addEventListener('click', function () {
                        displayMapperFileByName(value);
                    });
                    return 0;
                }
            }
            return 1;
        });

        const elJsonViewerTitle = document.querySelector('#jsonContent .json-viewer-title');
        elJsonViewerTitle.title = 'Click to open the file and copy file path';
        elJsonViewerTitle.addEventListener('click', function () {
            vscode.postMessage({ command: 'openFile', filePath });
            const tempTextArea = document.createElement('textarea');
            tempTextArea.value = filePath;
            document.body.appendChild(tempTextArea);
            tempTextArea.select();
            document.execCommand('copy');
            document.body.removeChild(tempTextArea);

            const copyMessageOverlay = document.querySelector("#copy-message");

            // Show and fade out the "Copied!" overlay
            copyMessageOverlay.classList.add('json-viewer-show-copy-message');
            setTimeout(() => {
                copyMessageOverlay.classList.remove('json-viewer-show-copy-message');
            }, 2000);
        });
    }

    // Function to load a nested mapper by name
    function displayMapperFileByName(mapperName) {
        vscode.postMessage({ command: 'getFileContent', mapperName });
    }
});