const vscode = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    // Request the endpoint configuration from the extension
    vscode.postMessage({ command: 'webviewLoaded' });

    // Handle messages from the extension
    window.addEventListener('message', async (event) => {
        const message = event.data;

        if (message.command === 'endpointConfig') {
            const endpointConfig = message.content;
            displayEndpointContent(endpointConfig);
        } else if (message.command === 'error') {
            console.error('Error from extension:', message.message);
        }
    });

    // Function to display the content of an endpoint
    function displayEndpointContent(endpoint) {
        showJsonContent(`Endpoint Details`, endpoint, "jsonContent", (key, value, valueSpan, parentKey, parentValue) => {
            if (parentKey === 'middleware' && Array.isArray(parentValue)) {
                valueSpan.title = 'Click to load middleware file';
                valueSpan.classList.add('json-viewer-json-mapper');
                valueSpan.addEventListener('click', function () {
                    vscode.postMessage({ command: 'openMiddlewareFile', middlewarePath: value });
                });
                return 0;
            }

            if (key === 'template' && typeof value === 'string') {
                valueSpan.title = 'Click to load Mapper config';
                valueSpan.classList.add('json-viewer-json-mapper');
                valueSpan.addEventListener('click', () => {
                    console.log('Opening mapper:', value);
                    vscode.postMessage({ command: 'openMapperViewer', mapperName: value });
                });
                return 0;
            }

            return 1; // Default rendering
        });
    }
});