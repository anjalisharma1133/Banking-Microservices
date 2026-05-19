package com.banking.audit.consumer;

import com.banking.audit.entity.AuditLog;
import com.banking.audit.repository.AuditLogRepository;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@ConditionalOnProperty(name = "spring.application.name", havingValue = "audit-service")
public class AuditConsumer {

    @Autowired
    private AuditLogRepository auditLogRepository;

    @KafkaListener(topics = "transaction-events", groupId = "audit-group")
    public void consume(org.apache.kafka.clients.consumer.ConsumerRecord<String, Object> record) {
        Object event = record.value();
        System.out.println("DEBUG: [AUDIT SERVICE] Kafka Message Received: " + event);
        try {
            AuditLog log = new AuditLog();
            log.setEvent("TRANSACTION_EVENT");
            
            String metadata = event.toString();
            String userId = "system";

            if (event instanceof java.util.Map) {
                java.util.Map<String, Object> map = (java.util.Map<String, Object>) event;
                Object initiator = map.get("initiatorUid");
                if (initiator != null) userId = initiator.toString();
                
                // If it's a specific event type, override
                Object eventType = map.get("eventType");
                if (eventType != null) log.setEvent(eventType.toString());
            } else {
                try {
                    java.lang.reflect.Method getInitiatorUid = event.getClass().getMethod("getInitiatorUid");
                    Object initiator = getInitiatorUid.invoke(event);
                    if (initiator != null) userId = initiator.toString();
                } catch (Exception ignored) {}
            }
            
            log.setUserId(userId);
            log.setMetadata(metadata);
            
            AuditLog saved = auditLogRepository.save(log);
            System.out.println("INFO: [AUDIT SERVICE] Audit log persisted with ID: " + saved.getId());
        } catch (Exception e) {
            System.err.println("ERROR: [AUDIT SERVICE] Failed to audit Kafka message: " + e.getMessage());
        }
    }
}
