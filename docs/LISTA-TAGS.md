LISTA DE TAGS — GOHIGHLEVEL Y COMANDO CENTRAL

TERRITORIO

1. zona_closer: cuando el contacto agenda una cita. Lo aplica GHL y reemplaza a zona_setter. Nunca se quita.

2. zona_setter: cuando el lead entra y todavía no agendó. Lo aplica GHL.


ESTADO DEL AGENTE DE IA

3. bot_activado: mientras el chatbot está atendiendo al contacto. Lo aplica GHL y lo quita cuando el bot deja de atender.

4. bot_reactivar: cuando se da la orden de volver a encender el bot. Lo aplica GHL.

5. bot_apagado_manual: cuando un humano apaga el bot desde GHL.

6. derivado_lt: cuando el bot deriva la conversación a low-ticket, o cuando alguien arrastra la tarjeta a la columna Low-Ticket ofrecido. Lo escriben los dos lados.

7. bot_desactivado_postcall: cuando el closer registra cualquier salida de Avanzar menos No-show. Lo aplica Comando Central.

8. bot_pausado_fallo: cuando el auditor de IA detecta un fallo grave. Lo aplica y lo quita Comando Central.


RESULTADOS DE AVANZAR — CLOSER

9. venta_ganada: cuando el closer registra una Venta.

10. adelanto_ganado: cuando el closer registra Acordó comprar, falta pago.

11. seguimiento: cuando se registra un Seguimiento, tanto del closer como del setter.

12. descalificado: cuando el closer registra No le interesa, o el setter registra No califica.

13. noshow: cuando el closer registra un No-show.

14. nurture_appflow: cuando el closer o el setter registran Nurture.


SEGUIMIENTOS

15. seguimiento_recupero: cuando el closer elige seguimiento automático. Dispara 3 toques en 7 días.

16. seguimiento_manual: cuando el closer o el setter eligen seguimiento manual. No dispara ningún workflow.

17. seguimiento_para_agendar: cuando el setter elige la serie para agendar. Dispara 3 toques en 5 días.

18. seguimiento_decision_lt: cuando el setter elige la serie de decisión low-ticket. Dispara 2 toques en 3 días.

19. seguimiento_terminado: sin confirmar. Por el nombre, cuando la serie se agota.


ETAPAS DEL PIPELINE DEL SETTER

20. setter_nuevo: cuando el contacto entra a la etapa Nuevo. FALTA CREARLO.

21. setter_en_calificacion: cuando el contacto pasa a la etapa En calificación. FALTA CREARLO.

22. setter_calificado: cuando el contacto pasa a Calificado sin agendar. FALTA CREARLO.


SOLO LECTURA

23. cita_agendada: cuando se agenda una cita. Lo aplica GHL junto con zona_closer.

24. estancado: cuando el workflow de barrido detecta inactividad. Lo aplica GHL.


PENDIENTE DE CREAR

25. (sin nombre): para la venta low-ticket del setter. Hoy no existe ningún tag que signifique eso.
