export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Payment API test endpoint
    if (url.pathname === "/api/test") {
      return Response.json({
        success: true,
        message: "USOA GROUP payment backend is working"
      });
    }

    // All normal website files continue to work
    return env.ASSETS.fetch(request);
  }
};
