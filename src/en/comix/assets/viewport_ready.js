async () => {
    const deadline = Date.now() + 5000;
    while (!(Number.isFinite(window.innerWidth) && window.innerWidth > 0 &&
             Number.isFinite(window.innerHeight) && window.innerHeight > 0)) {
        if (Date.now() >= deadline) {
            throw new Error(`Comix63: browser viewport stayed ${window.innerWidth}x${window.innerHeight} after layout`);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
