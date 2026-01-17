const root = document.querySelector("body");

if (root) {
  (async () => {
    const [{ App }, { hydrateRoot }] = await Promise.all([
      import("."),
      import("react-dom/client"),
    ]);
    hydrateRoot(root, <App />);
  })();
}
