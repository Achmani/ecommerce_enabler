self.addEventListener("push", (event) => {
  let data = { title: "Teman Makan", body: "Ada kabar tentang pesananmu.", url: "/" };
  try {
    if (event.data) data = { ...data, ...JSON.parse(event.data.text()) };
  } catch {
    // Keep the safe default notification.
  }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: { url: data.url }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/"));
});

