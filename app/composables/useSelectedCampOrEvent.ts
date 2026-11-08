export function useSelectedCampOrEvent() {
	return useState<{
		id: number;
		label: string;
		avatar: {
			src: string;
			alt: string;
		};
	} | null>("selectedCampOrEvent", () => null);
}
