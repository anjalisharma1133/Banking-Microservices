package com.banking.notification;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import java.util.HashMap;
import java.util.Map;

@Service
@ConditionalOnProperty(name = "spring.application.name", havingValue = "notification-service")
public class NotificationConsumer {

    private final org.springframework.web.client.RestTemplate restTemplate = new org.springframework.web.client.RestTemplate();
    
    @org.springframework.beans.factory.annotation.Value("${GATEWAY_URL:http://localhost:3000/api/internal/push-email}")
    private String GATEWAY_URL;

    @KafkaListener(topics = "transaction-events", groupId = "notification-group")
    public void consume(org.apache.kafka.clients.consumer.ConsumerRecord<String, Object> record) {
        Object event = record.value();
        System.out.println("DEBUG: [NOTIFICATION SERVICE] Received event for processing: " + event);
        
        try {
            String initiatorUid = "system";
            String from = "N/A";
            String to = "N/A";
            String amount = "0";
            
            if (event instanceof Map) {
                Map<String, Object> map = (Map<String, Object>) event;
                initiatorUid = String.valueOf(map.getOrDefault("initiatorUid", "system"));
                from = String.valueOf(map.getOrDefault("from", "N/A"));
                to = String.valueOf(map.getOrDefault("to", "N/A"));
                Object amt = map.get("amount");
                if (amt != null) amount = amt.toString();
            } else {
                try {
                    // Fallback reflection for POJOs
                    java.lang.reflect.Method getInitiatorUid = event.getClass().getMethod("getInitiatorUid");
                    Object uid = getInitiatorUid.invoke(event);
                    if (uid != null) initiatorUid = uid.toString();
                    
                    java.lang.reflect.Method getAmount = event.getClass().getMethod("getAmount");
                    Object amt = getAmount.invoke(event);
                    if (amt != null) amount = amt.toString();

                    java.lang.reflect.Method getFrom = event.getClass().getMethod("getFrom");
                    from = String.valueOf(getFrom.invoke(event));

                    java.lang.reflect.Method getTo = event.getClass().getMethod("getTo");
                    to = String.valueOf(getTo.invoke(event));
                } catch (Exception ignored) {}
            }

            // 1. Notify Sender
            Map<String, String> senderPayload = new HashMap<>();
            senderPayload.put("toUid", initiatorUid);
            senderPayload.put("subject", "Transfer Confirmation");
            senderPayload.put("body", "Your transfer of $" + amount + " to account " + to + " has been processed successfully. Thank you for using our digital bank.");
            restTemplate.postForObject(GATEWAY_URL, senderPayload, Map.class);
            System.out.println("INFO: [NOTIFICATION SERVICE] Sender notification sent to: " + initiatorUid);

            // 2. Notify Recipient (Gateway handles email lookup by accountNumber)
            Map<String, String> recipientPayload = new HashMap<>();
            recipientPayload.put("accountNumber", to);
            recipientPayload.put("subject", "Funds Received");
            recipientPayload.put("body", "You have received $" + amount + " from an external transfer (Account: " + from + "). Your balance has been updated.");
            restTemplate.postForObject(GATEWAY_URL, recipientPayload, Map.class);
            System.out.println("INFO: [NOTIFICATION SERVICE] Recipient notification sent for account: " + to);
            
        } catch (Exception e) {
            System.err.println("ERROR: [NOTIFICATION SERVICE] Callback failed: " + e.getMessage());
        }
    }
}
