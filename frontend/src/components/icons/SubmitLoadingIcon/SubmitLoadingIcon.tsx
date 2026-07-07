import './_submitLoadingIcon.scss'

export function SubmitLoadingIcon() {
	return (
		<svg className="loader-icon" viewBox="0 0 24 24" aria-hidden="true">
			<circle className="loader-icon__track" cx="12" cy="12" r="9" />
			<path className="loader-icon__line" d="M21 12a9 9 0 0 0-9-9" />
		</svg>
	);
}
