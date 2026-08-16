LISTA DE TAGS — GOHIGHLEVEL Y COMANDO CENTRAL

Al final de cada tag, entre paréntesis, quién lo escribe y quién lo lee:

lo escribe GHL = lo aplica un workflow de la subcuenta.
lo escribe CC  = lo aplica Comando Central cuando alguien registra algo. GHL no debe aplicarlo o se pisan.
lo lee GHL     = hace falta un workflow que DISPARE con ese tag. Es lo que hay que armar del lado de GHL.
lo lee CC      = Comando Central deriva algo de él: una etapa, una cola o el estado del bot.

Los nombres van exactos: minúsculas, guion bajo, sin acentos ni espacios. Un tag mal escrito no da
error, no hace nada.

TERRITORIO

1. zona_closer: cuando el contacto agenda una cita. Lo aplica GHL y reemplaza a zona_setter. Nunca se quita. (lo escribe GHL / lo lee CC)

2. zona_setter: cuando el lead entra y todavía no agendó. Lo aplica GHL. (lo escribe GHL / lo lee CC)


ESTADO DEL AGENTE DE IA

3. bot_activado_appflow: mientras el agente de chat POST-AGENDA (Appointment Flow) está atendiendo al contacto. Lo aplica GHL y lo quita cuando ese bot deja de atender. Es lo que habilita a su auditor: sin este tag, Comando Central no analiza a ese contacto. (lo escribe GHL / lo lee CC)

3b. bot_activado_leadflow: lo mismo para el agente de chat PRE-AGENDA (Lead Flow). Son dos tags y no uno porque el auditor tiene que saber CUÁL agente está atendiendo: juzgar al Appointment Flow por una conversación que atendió el Lead Flow le imputaría el fallo al equivocado. (lo escribe GHL / lo lee CC)

4. bot_reactivar: cuando se da la orden de volver a encender el bot. Lo aplica GHL. (lo escribe GHL / lo lee GHL / lo lee CC)

5. bot_apagado_manual: cuando un humano apaga el bot desde GHL. (lo escribe GHL / lo lee CC)

6. derivado_lt: cuando el bot deriva la conversación a low-ticket, o cuando alguien arrastra la tarjeta a la columna Low-Ticket ofrecido. Lo escriben los dos lados. (lo escribe GHL / lo escribe CC / lo lee CC)

7. bot_desactivado_postcall: cuando el closer registra cualquier salida de Avanzar menos No-show. Lo aplica Comando Central. (lo escribe CC / lo lee GHL / lo lee CC)

8. bot_desactivado_appflow: cuando el auditor de IA detecta un fallo grave del agente de chat POST-AGENDA. Lo aplica Comando Central, y **GHL tiene que reaccionar pausando ese bot**. Lo quita Comando Central cuando un humano resuelve la intervención. (lo escribe CC / lo lee GHL / lo lee CC)

8b. bot_desactivado_leadflow: lo mismo para el agente de chat PRE-AGENDA. Cada uno pausa a su bot: con un tag único, un fallo del Lead Flow apagaría también al Appointment Flow, que puede estar trabajando bien. (lo escribe CC / lo lee GHL / lo lee CC)

8c. bot_pausado_fallo: LEGADO. Era el tag único que hacía lo de 8 y 8b antes del 2026-08-16. Comando Central ya no lo aplica, pero lo sigue leyendo —y quitando al resolver— porque quedaron contactos con él puesto. No hace falta crearlo en GHL ni ponerlo en ningún workflow nuevo. (lo lee CC)


RESULTADOS DE AVANZAR — CLOSER

9. venta_ganada: cuando el closer registra una Venta. (lo escribe CC / lo lee GHL / lo lee CC)

10. adelanto_ganado: cuando el closer registra Acordó comprar, falta pago. (lo escribe CC / lo lee GHL / lo lee CC)

11. seguimiento: cuando se registra un Seguimiento, tanto del closer como del setter. (lo escribe CC / lo lee GHL / lo lee CC)

12. descalificado: cuando el closer registra No le interesa, o el setter registra No califica. (lo escribe CC / lo lee GHL / lo lee CC)

13. noshow: cuando el closer registra un No-show. (lo escribe CC / lo lee GHL / lo lee CC)

14. nurture_appflow: cuando el closer o el setter registran Nurture. (lo escribe CC / lo lee GHL / lo lee CC)


SEGUIMIENTOS

15. seguimiento_recupero: cuando el closer elige seguimiento automático. Dispara 3 toques en 7 días. (lo escribe CC / lo lee GHL)

16. seguimiento_manual: cuando el closer o el setter eligen seguimiento manual. No dispara ningún workflow. (lo escribe CC / lo lee GHL)

17. seguimiento_para_agendar: cuando el setter elige la serie para agendar. Dispara 3 toques en 5 días. (lo escribe CC / lo lee GHL)

18. seguimiento_decision_lt: cuando el setter elige la serie de decisión low-ticket. Dispara 2 toques en 3 días. (lo escribe CC / lo lee GHL)

19. seguimiento_terminado: sin confirmar. Por el nombre, cuando la serie se agota. (lo escribe GHL / todavía no lo lee nadie)


ETAPAS DEL PIPELINE DEL SETTER

20. setter_nuevo: cuando el contacto entra a la etapa Nuevo. FALTA CREARLO. (lo escribe CC / lo lee CC)

21. setter_en_calificacion: cuando el contacto pasa a la etapa En calificación. FALTA CREARLO. (lo escribe CC / lo lee CC)

22. setter_calificado: cuando el contacto pasa a Calificado sin agendar. FALTA CREARLO. (lo escribe CC / lo lee CC)


SOLO LECTURA

23. cita_agendada: cuando se agenda una cita. Lo aplica GHL junto con zona_closer. (lo escribe GHL / lo lee GHL / lo lee CC)

24. estancado: cuando el workflow de barrido detecta inactividad. Lo aplica GHL. (lo escribe GHL / lo lee CC)


PENDIENTE DE CREAR

25. (sin nombre): para la venta low-ticket del setter. Hoy no existe ningún tag que signifique eso. (lo escribiría CC / lo leería GHL)
