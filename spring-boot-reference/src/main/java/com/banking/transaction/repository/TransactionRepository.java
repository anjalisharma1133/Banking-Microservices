package com.banking.transaction.repository;

import com.banking.transaction.entity.Transaction;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface TransactionRepository extends JpaRepository<Transaction, String> {
    List<Transaction> findByInitiatorUidOrderByTimestampDesc(String initiatorUid);
    List<Transaction> findByFromOrToOrderByTimestampDesc(String from, String to);
    List<Transaction> findAllByOrderByTimestampDesc();
}
