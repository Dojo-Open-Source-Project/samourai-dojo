import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { queryClient } from "./query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	return createRouter({
		routeTree,
		basepath: "/admin",
		trailingSlash: "always",
		Wrap: ({ children }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	});
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
