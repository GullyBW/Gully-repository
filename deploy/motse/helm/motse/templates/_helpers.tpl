{{- define "motse.image" -}}
{{ .Values.image.repository }}:{{ required "image.tag must be pinned by CI" .Values.image.tag }}
{{- end -}}
